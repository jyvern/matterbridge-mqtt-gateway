/**
 * matterbridge-mqtt-gateway — MqttPlatform
 * Compatible Matterbridge v3.x
 */

// ── Matterbridge ──────────────────────────────────────────────────────────────
import * as matterbridge from 'matterbridge';
const {
  MatterbridgeDynamicPlatform,
  onOffOutlet,
  onOffSwitch,
  dimmableLight,
  colorTemperatureLight,
  contactSensor,
  temperatureSensor,
  humiditySensor,
  occupancySensor,
  coverDevice,
  fanDevice,
  aggregator,
  bridgedNode,
  powerSource,
  getAttribute,
  setAttribute,
} = matterbridge;

import type { PlatformMatterbridge, PlatformConfig, MatterbridgeEndpoint } from 'matterbridge';

// ── Logger ────────────────────────────────────────────────────────────────────
import { AnsiLogger } from 'node-ansi-logger';

// ── MQTT ──────────────────────────────────────────────────────────────────────
import mqtt, { MqttClient, IClientOptions } from 'mqtt';

// ── Cluster IDs Matter ───────────────────────────────────────────────────────
const CID = {
  OnOff:                       0x0006,
  LevelControl:                0x0008,
  ColorControl:                0x0300,
  BooleanState:                0x0045,
  TemperatureMeasurement:      0x0402,
  RelativeHumidityMeasurement: 0x0405,
  OccupancySensing:            0x0406,
  WindowCovering:              0x0102,
  FanControl:                  0x0202,
  Thermostat:                  0x0201,
} as const;

// Device type Matter "Thermostat" (spec ID 0x0301) — défini manuellement
// car certaines versions de matterbridge n'exportent pas la constante.
// Recherche du device type thermostat dans tous les exports de matterbridge
const thermostatDeviceType: any =
  // 1. Export direct
  (matterbridge as any).thermostat ??
  (matterbridge as any).Thermostat ??
  // 2. Scan de tous les exports : on cherche un objet avec code 0x0301
  Object.values(matterbridge as any).find(
    (v: any) =>
      v !== null &&
      typeof v === 'object' &&
      (v.code === 0x0301 ||
       v.deviceType === 0x0301 ||
       (typeof v.name === 'string' && v.name.toLowerCase().includes('thermostat')))
  ) ??
  // 3. Fallback avec tous les champs que Matterbridge peut lire
  {
    name:           'MA-thermostat',
    code:           0x0301,
    deviceType:     0x0301,
    deviceRevision: 2,
    tag:            'MA-thermostat',
    typeName:       'MA-thermostat',
  };

// ── Config appareil MQTT ───────────────────────────────────────────────────────

type DeviceKind =
  | 'outlet' | 'switch'
  | 'light'  | 'colorlight'
  | 'contact_sensor'
  | 'temperature' | 'humidity' | 'occupancy'
  | 'cover'
  | 'stove'
  | 'thermostat';

interface MqttDeviceConfig {
  id:   string;
  name: string;
  type?: DeviceKind;

  stateTopic?:   string;
  commandTopic?: string;
  payloadOn?:    string;
  payloadOff?:   string;
  retain?:       boolean;

  brightnessStateTopic?:   string;
  brightnessCommandTopic?: string;
  colorStateTopic?:        string;
  colorCommandTopic?:      string;

  payloadOpen?:   string;
  payloadClosed?: string;

  // cover
  positionStateTopic?:   string;
  positionCommandTopic?: string;
  payloadStop?:          string;

  // stove
  speedStateTopic?:      string;   // puissance actuelle (1–5)
  speedCommandTopic?:    string;   // puissance absolue  (1–5)
  speedStepTopic?:       string;   // incrément puissance (+1 / -1)
  fanSpeedStateTopic?:   string;   // soufflerie actuelle (0–5, lecture seule)
  fanSpeedStepTopic?:    string;   // incrément soufflerie (+1 / -1, commande uniquement)
  speedMin?:             number;   // défaut 1
  speedMax?:             number;   // défaut 5

  // thermostat
  targetTempStateTopic?:   string;
  targetTempCommandTopic?: string;
}

// ── Typage des handlers de commandes ─────────────────────────────────────────
interface LevelRequest   { request: { level: number }; }
interface HueSatRequest  { request: { hue: number; saturation: number }; }
interface ColorTempRequest { request: { colorTemperatureMireds: number }; }

type AnyHandler = (data: any) => void | Promise<void>;

// ── Platform ──────────────────────────────────────────────────────────────────

export class MqttPlatform extends MatterbridgeDynamicPlatform {
  private mqttClient:   MqttClient | undefined;
  private topicHandlers = new Map<string, Array<(p: string) => void>>();
  private endpointMap   = new Map<string, MatterbridgeEndpoint>();

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);
    this.log.info('MqttPlatform created');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onStart(reason?: string): Promise<void> {
    this.log.info(`onStart: ${reason ?? '-'}`);
    await this.connectMqtt();

    const devices: MqttDeviceConfig[] = (this.config['devices'] as MqttDeviceConfig[]) ?? [];
    if (!devices.length) { this.log.warn('No devices configured.'); return; }

    for (const cfg of devices) {
      try   { await this.createDevice(cfg); }
      catch (err) { this.log.error(`Device "${cfg.id}" failed: ${err}`); }
    }
  }

  async onConfigure(): Promise<void> {
    this.log.info('onConfigure: all devices ready');
  }

  async onShutdown(reason?: string): Promise<void> {
    this.log.info(`onShutdown: ${reason ?? '-'}`);
    if (this.mqttClient?.connected) {
      await this.mqttClient.endAsync();
      this.log.info('MQTT disconnected');
    }
  }

  // ── MQTT ───────────────────────────────────────────────────────────────────

  private async connectMqtt(): Promise<void> {
    const broker   = (this.config['broker']   as string) ?? 'mqtt://localhost:1883';
    const username = (this.config['username'] as string) ?? '';
    const password = (this.config['password'] as string) ?? '';
    const clientId = (this.config['clientId'] as string) ??
                     `mb_mqtt_${Math.random().toString(16).slice(2, 8)}`;

    const opts: IClientOptions = {
      clientId,
      clean: true, reconnectPeriod: 5000, connectTimeout: 10_000,
    };
    if (username) opts.username = username;
    if (password) opts.password = password;

    this.log.info(`MQTT → ${broker} [${clientId}]`);

    return new Promise((resolve, reject) => {
      this.mqttClient = mqtt.connect(broker, opts);
      this.mqttClient.once('connect', () => { this.log.info('MQTT connected ✓'); resolve(); });
      this.mqttClient.once('error',   (e) => { this.log.error(`MQTT error: ${e.message}`); reject(e); });
      this.mqttClient.on('reconnect', ()  => this.log.warn('MQTT reconnecting…'));
      this.mqttClient.on('message', (topic, buf) => {
        const payload = buf.toString().trim();
        this.log.debug(`← [${topic}] ${payload}`);
        const handlers = this.topicHandlers.get(topic);
        if (!handlers) {
          this.log.warn(`← [${topic}] aucun handler enregistré pour ce topic`);
          return;
        }
        handlers.forEach(h => {
          try { h(payload); } catch (e) { this.log.error(`Handler [${topic}]: ${e}`); }
        });
      });
    });
  }

  private subscribe(topic: string, handler: (p: string) => void): void {
    if (!this.mqttClient) return;
    const list = this.topicHandlers.get(topic);
    if (list) { list.push(handler); return; }
    this.topicHandlers.set(topic, [handler]);
    this.mqttClient.subscribe(topic, (err) => {
      if (err) this.log.error(`Subscribe failed [${topic}]: ${err.message}`);
      else     this.log.info(`subscribed → ${topic}`);
    });
  }

  private publish(topic: string, payload: string, retain = false): void {
    if (!this.mqttClient?.connected) { this.log.warn(`Not connected, skip [${topic}]`); return; }
    this.mqttClient.publish(topic, payload, { retain, qos: 1 });
    if (this.config['debug']) this.log.debug(`→ [${topic}] ${payload}`);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getAttr(ep: MatterbridgeEndpoint, clusterId: number, attr: string): unknown {
    return getAttribute(ep, clusterId as any, attr, this.log);
  }

  private setAttr(ep: MatterbridgeEndpoint, clusterId: number, attr: string, value: any): void {
    void setAttribute(ep, clusterId as any, attr, value, this.log);
  }

  private initEp(ep: MatterbridgeEndpoint, cfg: MqttDeviceConfig, productId: number): void {
    ep.createDefaultBasicInformationClusterServer(
      cfg.name,
      `mqtt-${cfg.id}`,
      0xfff1,
      'MQTT-Bridge',
      productId,
      'matterbridge-mqtt-gateway',
    );
    ep.createDefaultIdentifyClusterServer();
  }

  private onCmd(ep: MatterbridgeEndpoint, cmd: string, fn: AnyHandler): void {
    ep.addCommandHandler(
      cmd as any,
      fn  as any,
    );
  }

  // ── Device factory ─────────────────────────────────────────────────────────

  private async createDevice(cfg: MqttDeviceConfig): Promise<void> {
    switch (cfg.type ?? 'outlet') {
      case 'outlet':         return this.createOnOff(cfg, onOffOutlet, 0x8000);
      case 'switch':         return this.createOnOff(cfg, onOffSwitch, 0x8001);
      case 'light':          return this.createDimmable(cfg);
      case 'colorlight':     return this.createColor(cfg);
      case 'contact_sensor': return this.createContact(cfg);
      case 'temperature':    return this.createTemp(cfg);
      case 'humidity':       return this.createHumidity(cfg);
      case 'occupancy':      return this.createOccupancy(cfg);
      case 'cover':          return this.createCover(cfg);
      case 'stove':          return this.createStove(cfg);
      case 'thermostat':     return this.createThermostat(cfg);
      default: this.log.warn(`Unknown type "${cfg.type}" — skipping "${cfg.id}"`);
    }
  }

  // ── OnOff — outlet / switch ────────────────────────────────────────────────

  private async createOnOff(
    cfg:     MqttDeviceConfig,
    devType: typeof onOffOutlet,
    pid:     number,
  ): Promise<void> {
    const ON  = cfg.payloadOn  ?? 'ON';
    const OFF = cfg.payloadOff ?? 'OFF';

    const ep = new matterbridge.MatterbridgeEndpoint([devType, powerSource]);
    this.initEp(ep, cfg, pid);
    ep.createDefaultOnOffClusterServer();

    this.onCmd(ep, 'on',     async () => {
      this.log.info(`[${cfg.name}] → ON`);
      if (cfg.commandTopic) this.publish(cfg.commandTopic, ON, cfg.retain);
    });
    this.onCmd(ep, 'off',    async () => {
      this.log.info(`[${cfg.name}] → OFF`);
      if (cfg.commandTopic) this.publish(cfg.commandTopic, OFF, cfg.retain);
    });
    this.onCmd(ep, 'toggle', async () => {
      const cur = (this.getAttr(ep, CID.OnOff, 'onOff') as boolean) ?? false;
      this.log.info(`[${cfg.name}] → TOGGLE (was ${cur ? 'ON' : 'OFF'})`);
      if (cfg.commandTopic) this.publish(cfg.commandTopic, cur ? OFF : ON, cfg.retain);
    });

    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        const v = this.parseOnOff(p, ON, OFF);
        if (v !== null) {
          this.log.info(`[${cfg.name}] ← ${v ? 'ON' : 'OFF'}`);
          this.setAttr(ep, CID.OnOff, 'onOff', v);
        }
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ ${cfg.type ?? 'outlet'} "${cfg.name}"`);
  }

  // ── Dimmable light ─────────────────────────────────────────────────────────

  private async createDimmable(cfg: MqttDeviceConfig): Promise<void> {
    const ON  = cfg.payloadOn  ?? 'ON';
    const OFF = cfg.payloadOff ?? 'OFF';

    const ep = new matterbridge.MatterbridgeEndpoint([dimmableLight, powerSource]);
    this.initEp(ep, cfg, 0x8002);
    ep.createDefaultOnOffClusterServer();
    ep.createDefaultLevelControlClusterServer();

    this.onCmd(ep, 'on',  async () => { if (cfg.commandTopic) this.publish(cfg.commandTopic, ON,  cfg.retain); });
    this.onCmd(ep, 'off', async () => { if (cfg.commandTopic) this.publish(cfg.commandTopic, OFF, cfg.retain); });

    const levelHandler = async (data: LevelRequest): Promise<void> => {
      const lv254 = data.request.level;
      const lv100 = Math.round((lv254 / 254) * 100);
      this.log.info(`[${cfg.name}] → level ${lv254} (${lv100}%)`);
      if (cfg.brightnessCommandTopic) this.publish(cfg.brightnessCommandTopic, String(lv100), cfg.retain);
      if (cfg.commandTopic)           this.publish(cfg.commandTopic, lv254 > 0 ? ON : OFF, cfg.retain);
    };
    this.onCmd(ep, 'moveToLevel',          levelHandler as AnyHandler);
    this.onCmd(ep, 'moveToLevelWithOnOff', levelHandler as AnyHandler);

    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        const v = this.parseOnOff(p, ON, OFF);
        if (v !== null) this.setAttr(ep, CID.OnOff, 'onOff', v);
      });
    }
    if (cfg.brightnessStateTopic) {
      this.subscribe(cfg.brightnessStateTopic, (p) => {
        const raw = parseFloat(p);
        if (!isNaN(raw)) {
          const lv = raw <= 100 ? Math.round((raw / 100) * 254) : Math.min(Math.round(raw), 254);
          this.setAttr(ep, CID.LevelControl, 'currentLevel', lv);
        }
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ dimmable light "${cfg.name}"`);
  }

  // ── Color / CT light ───────────────────────────────────────────────────────

  private async createColor(cfg: MqttDeviceConfig): Promise<void> {
    const ON  = cfg.payloadOn  ?? 'ON';
    const OFF = cfg.payloadOff ?? 'OFF';

    const ep = new matterbridge.MatterbridgeEndpoint([colorTemperatureLight, powerSource]);
    this.initEp(ep, cfg, 0x8003);
    ep.createDefaultOnOffClusterServer();
    ep.createDefaultLevelControlClusterServer();
    ep.createDefaultColorControlClusterServer();

    this.onCmd(ep, 'on',  async () => { if (cfg.commandTopic) this.publish(cfg.commandTopic, ON,  cfg.retain); });
    this.onCmd(ep, 'off', async () => { if (cfg.commandTopic) this.publish(cfg.commandTopic, OFF, cfg.retain); });

    const levelHandler = async (data: LevelRequest): Promise<void> => {
      const lv100 = Math.round((data.request.level / 254) * 100);
      if (cfg.brightnessCommandTopic) this.publish(cfg.brightnessCommandTopic, String(lv100), cfg.retain);
    };
    this.onCmd(ep, 'moveToLevel',          levelHandler as AnyHandler);
    this.onCmd(ep, 'moveToLevelWithOnOff', levelHandler as AnyHandler);

    this.onCmd(ep, 'moveToHueAndSaturation', (async (data: HueSatRequest) => {
      const hue360 = Math.round((data.request.hue        / 254) * 360);
      const sat100 = Math.round((data.request.saturation / 254) * 100);
      this.log.info(`[${cfg.name}] → H${hue360}° S${sat100}%`);
      if (cfg.colorCommandTopic)
        this.publish(cfg.colorCommandTopic, JSON.stringify({ hue: hue360, saturation: sat100 }), cfg.retain);
    }) as AnyHandler);

    this.onCmd(ep, 'moveToColorTemperature', (async (data: ColorTempRequest) => {
      const mireds = data.request.colorTemperatureMireds;
      this.log.info(`[${cfg.name}] → ${mireds} mireds`);
      if (cfg.colorCommandTopic)
        this.publish(cfg.colorCommandTopic, JSON.stringify({ colorTemp: mireds }), cfg.retain);
    }) as AnyHandler);

    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        const v = this.parseOnOff(p, ON, OFF);
        if (v !== null) this.setAttr(ep, CID.OnOff, 'onOff', v);
      });
    }
    if (cfg.brightnessStateTopic) {
      this.subscribe(cfg.brightnessStateTopic, (p) => {
        const raw = parseFloat(p);
        if (!isNaN(raw)) {
          const lv = raw <= 100 ? Math.round((raw / 100) * 254) : Math.min(Math.round(raw), 254);
          this.setAttr(ep, CID.LevelControl, 'currentLevel', lv);
        }
      });
    }
    if (cfg.colorStateTopic) {
      this.subscribe(cfg.colorStateTopic, (p) => {
        try {
          const d = JSON.parse(p) as Record<string, number>;
          if (d['hue']        !== undefined) this.setAttr(ep, CID.ColorControl, 'currentHue',             Math.round((d['hue']        / 360) * 254));
          if (d['saturation'] !== undefined) this.setAttr(ep, CID.ColorControl, 'currentSaturation',      Math.round((d['saturation'] / 100) * 254));
          if (d['colorTemp']  !== undefined) this.setAttr(ep, CID.ColorControl, 'colorTemperatureMireds', d['colorTemp']);
        } catch {
          const m = parseInt(p, 10);
          if (!isNaN(m)) this.setAttr(ep, CID.ColorControl, 'colorTemperatureMireds', m);
        }
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ color light "${cfg.name}"`);
  }

  // ── Contact sensor ─────────────────────────────────────────────────────────

  private async createContact(cfg: MqttDeviceConfig): Promise<void> {
    const OPEN   = cfg.payloadOpen   ?? 'OPEN';
    const CLOSED = cfg.payloadClosed ?? 'CLOSED';

    const ep = new matterbridge.MatterbridgeEndpoint([contactSensor, powerSource]);
    this.initEp(ep, cfg, 0x8004);
    ep.createDefaultBooleanStateClusterServer(true);

    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        let contact: boolean;
        if      (p === OPEN)   contact = false;
        else if (p === CLOSED) contact = true;
        else { const l = p.toLowerCase(); contact = l === '1' || l === 'true' || l === 'closed'; }
        this.log.info(`[${cfg.name}] ← ${contact ? 'CLOSED' : 'OPEN'}`);
        this.setAttr(ep, CID.BooleanState, 'stateValue', contact);
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ contact sensor "${cfg.name}"`);
  }

  // ── Temperature sensor ─────────────────────────────────────────────────────

  private async createTemp(cfg: MqttDeviceConfig): Promise<void> {
    const ep = new matterbridge.MatterbridgeEndpoint([temperatureSensor, powerSource]);
    this.initEp(ep, cfg, 0x8005);
    ep.createDefaultTemperatureMeasurementClusterServer(2000);

    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        let c: number | null = null;
        try {
          const o = JSON.parse(p) as Record<string, unknown>;
          c = parseFloat(String(o['temperature'] ?? o['temp'] ?? o['value'] ?? o ?? ''));
        } catch { c = parseFloat(p); }
        if (c !== null && !isNaN(c)) {
          this.log.info(`[${cfg.name}] ← ${c}°C`);
          this.setAttr(ep, CID.TemperatureMeasurement, 'measuredValue', Math.round(c * 100));
        }
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ temperature sensor "${cfg.name}"`);
  }

  // ── Humidity sensor ────────────────────────────────────────────────────────

  private async createHumidity(cfg: MqttDeviceConfig): Promise<void> {
    const ep = new matterbridge.MatterbridgeEndpoint([humiditySensor, powerSource]);
    this.initEp(ep, cfg, 0x8006);
    ep.createDefaultRelativeHumidityMeasurementClusterServer(5000);

    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        let h: number | null = null;
        try {
          const o = JSON.parse(p) as Record<string, unknown>;
          h = parseFloat(String(o['humidity'] ?? o['value'] ?? o ?? ''));
        } catch { h = parseFloat(p); }
        if (h !== null && !isNaN(h)) {
          this.log.info(`[${cfg.name}] ← ${h}%`);
          this.setAttr(ep, CID.RelativeHumidityMeasurement, 'measuredValue', Math.round(h * 100));
        }
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ humidity sensor "${cfg.name}"`);
  }

  // ── Window Covering (volet) ────────────────────────────────────────────────

  private async createCover(cfg: MqttDeviceConfig): Promise<void> {
    const OPEN  = cfg.payloadOpen  ?? 'OPEN';
    const CLOSE = cfg.payloadClosed ?? 'CLOSE';
    const STOP  = cfg.payloadStop  ?? 'STOP';
    // Alias courants pour l'état fermé reçu en retour du broker
    const CLOSED_ALIASES = [CLOSE.toUpperCase(), 'CLOSED', 'CLOSE'];

    const ep = new matterbridge.MatterbridgeEndpoint([coverDevice, powerSource]);
    this.initEp(ep, cfg, 0x8008);
    ep.createDefaultWindowCoveringClusterServer();

    // ── Commandes Matter → MQTT ──────────────────────────────────────────────

    // Ouvrir complètement (position 0 % = ouvert dans Matter)
    this.onCmd(ep, 'upOrOpen', async () => {
      this.log.info(`[${cfg.name}] → OPEN`);
      if (cfg.commandTopic) this.publish(cfg.commandTopic, OPEN, cfg.retain);
      if (cfg.positionCommandTopic) this.publish(cfg.positionCommandTopic, '0', cfg.retain);
      this.setAttr(ep, CID.WindowCovering, 'targetPositionLiftPercent100ths', 0);
    });

    // Fermer complètement (position 10000 = 100 % fermé dans Matter)
    this.onCmd(ep, 'downOrClose', async () => {
      this.log.info(`[${cfg.name}] → CLOSE`);
      if (cfg.commandTopic) this.publish(cfg.commandTopic, CLOSE, cfg.retain);
      if (cfg.positionCommandTopic) this.publish(cfg.positionCommandTopic, '100', cfg.retain);
      this.setAttr(ep, CID.WindowCovering, 'targetPositionLiftPercent100ths', 10000);
    });

    // Arrêter le mouvement
    this.onCmd(ep, 'stopMotion', async () => {
      this.log.info(`[${cfg.name}] → STOP`);
      if (cfg.commandTopic) this.publish(cfg.commandTopic, STOP, cfg.retain);
    });

    // Positionner à un pourcentage précis
    // Matter envoie GoToLiftPercentage avec liftPercent100thsValue (0–10000)
    this.onCmd(ep, 'goToLiftPercentage', async (data: any) => {
      // Valeur Matter : 0 = ouvert, 10000 = fermé
      const matter100ths: number = data?.request?.liftPercent100thsValue ?? 0;
      const pct = Math.round(matter100ths / 100); // 0–100
      this.log.info(`[${cfg.name}] → position ${pct}%`);
      if (cfg.positionCommandTopic) this.publish(cfg.positionCommandTopic, String(pct), cfg.retain);
      this.setAttr(ep, CID.WindowCovering, 'targetPositionLiftPercent100ths', matter100ths);
    });

    // ── États MQTT → Matter ──────────────────────────────────────────────────

    // Topic commande (OPEN / CLOSE / STOP)
    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        const u = p.toUpperCase();
        if (u === OPEN.toUpperCase()) {
          this.setAttr(ep, CID.WindowCovering, 'currentPositionLiftPercent100ths', 0);
          this.setAttr(ep, CID.WindowCovering, 'targetPositionLiftPercent100ths',  0);
        } else if (CLOSED_ALIASES.includes(u)) {
          this.setAttr(ep, CID.WindowCovering, 'currentPositionLiftPercent100ths', 10000);
          this.setAttr(ep, CID.WindowCovering, 'targetPositionLiftPercent100ths',  10000);
        }
        this.log.info(`[${cfg.name}] ← state ${p}`);
      });
    }

    // Topic position (0–100 %)
    if (cfg.positionStateTopic) {
      this.subscribe(cfg.positionStateTopic, (p) => {
        let pct: number | null = null;
        try {
          const o = JSON.parse(p) as Record<string, unknown>;
          pct = parseFloat(String(o['position'] ?? o['value'] ?? ''));
        } catch { pct = parseFloat(p); }

        if (pct !== null && !isNaN(pct)) {
          const matter100ths = Math.round(Math.max(0, Math.min(100, pct)) * 100);
          this.log.info(`[${cfg.name}] ← position ${pct}% (${matter100ths}/10000)`);
          this.setAttr(ep, CID.WindowCovering, 'currentPositionLiftPercent100ths', matter100ths);
        }
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ cover \"${cfg.name}\"`);
  }

  // ── Poêle à granulés (Composite device) ───────────────────────────────────
  //
  // Architecture Matter :
  //   Endpoint racine  : aggregator
  //   Child "switch"   : onOffSwitch  → marche / arrêt
  //   Child "puissance": fanDevice    → puissance granulés (0–5, percentSetting 0–100%)
  //   Child "soufflerie": fanDevice   → vitesse ventilateur (0–5, percentSetting 0–100%)
  //
  // Conversions :
  //   niveau (0–5) → pct = round(niveau / MAX * 100)
  //   pct → niveau = round(pct / 100 * MAX)

  private async createStove(cfg: MqttDeviceConfig): Promise<void> {
    const ON      = cfg.payloadOn  ?? 'ON';
    const OFF     = cfg.payloadOff ?? 'OFF';
    const SPD_MAX = cfg.speedMax ?? 5;
    const FAN_MAX = 5;

    // Conversions niveau ↔ pourcentage Matter
    const lvToPct = (lv: number, max: number): number =>
      Math.round(Math.max(0, Math.min(max, lv)) / max * 100);
    const pctToLv = (pct: number, max: number): number =>
      Math.round(Math.max(0, Math.min(100, pct)) / 100 * max);

    // ── Endpoint racine (aggregator) ────────────────────────────────────────
    const ep = new matterbridge.MatterbridgeEndpoint([aggregator, powerSource]);
    this.initEp(ep, cfg, 0x8009);

    // ── Child 1 : switch (marche/arrêt) ─────────────────────────────────────
    const swChild = ep.addChildDeviceTypeWithClusterServer(
      `${cfg.id}-switch`,
      onOffSwitch,
      [CID.OnOff],
    );

    swChild.addCommandHandler('on', async () => {
      this.log.info(`[${cfg.name}] → MARCHE`);
      if (cfg.commandTopic) this.publish(cfg.commandTopic, ON, cfg.retain);
    });
    swChild.addCommandHandler('off', async () => {
      this.log.info(`[${cfg.name}] → ARRÊT`);
      if (cfg.commandTopic) this.publish(cfg.commandTopic, OFF, cfg.retain);
    });

    // ── Child 2 : fan puissance (granulés) ──────────────────────────────────
    const spdChild = ep.addChildDeviceTypeWithClusterServer(
      `${cfg.id}-puissance`,
      fanDevice,
      [CID.FanControl],
    );
    spdChild.createDefaultFanControlClusterServer();

    let currentSpeed = 0;
    spdChild.subscribeAttribute(CID.FanControl, 'percentSetting', (newPct: number) => {
      const newSpeed = pctToLv(newPct, SPD_MAX);
      if (newSpeed === currentSpeed) return;
      const prev = currentSpeed;
      currentSpeed = newSpeed;
      this.log.info(`[${cfg.name}] → puissance ${newSpeed} (${newPct}%)`);
      if (cfg.speedCommandTopic)
        this.publish(cfg.speedCommandTopic, String(newSpeed), cfg.retain);
      if (cfg.speedStepTopic) {
        const delta = newSpeed - prev;
        if (delta !== 0)
          this.publish(cfg.speedStepTopic, delta > 0 ? '+1' : '-1', cfg.retain);
      }
    }, this.log);

    // ── Child 3 : fan soufflerie (ventilateur) ──────────────────────────────
    const fanChild = ep.addChildDeviceTypeWithClusterServer(
      `${cfg.id}-soufflerie`,
      fanDevice,
      [CID.FanControl],
    );
    fanChild.createDefaultFanControlClusterServer();

    let currentFan = 0;
    fanChild.subscribeAttribute(CID.FanControl, 'percentSetting', (newPct: number) => {
      const newFan = pctToLv(newPct, FAN_MAX);
      if (newFan === currentFan) return;
      const prev = currentFan;
      currentFan = newFan;
      this.log.info(`[${cfg.name}] → soufflerie ${newFan} (${newPct}%)`);
      if (cfg.fanSpeedStepTopic) {
        const delta = newFan - prev;
        if (delta !== 0)
          this.publish(cfg.fanSpeedStepTopic, delta > 0 ? '+1' : '-1', cfg.retain);
      }
    }, this.log);

    // ── États MQTT → Matter ────────────────────────────────────────────────

    // Topic principal : payload brut (ON/OFF) ou JSON {"power":"ON","speed":3,"fan":2}
    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        let power: boolean | null = null;
        let speed: number | null  = null;
        let fan:   number | null  = null;

        try {
          const o = JSON.parse(p) as Record<string, unknown>;
          const s = String(o['power'] ?? o['state'] ?? '').toUpperCase();
          if (s === ON.toUpperCase()  || s === '1' || s === 'TRUE')  power = true;
          if (s === OFF.toUpperCase() || s === '0' || s === 'FALSE') power = false;
          speed = o['speed'] != null ? parseFloat(String(o['speed'])) : null;
          fan   = o['fan']   != null ? parseFloat(String(o['fan']))   : null;
        } catch {
          const u = p.toUpperCase();
          if (u === ON.toUpperCase()  || u === '1' || u === 'TRUE')  power = true;
          if (u === OFF.toUpperCase() || u === '0' || u === 'FALSE') power = false;
        }

        if (power !== null) {
          this.log.info(`[${cfg.name}] ← ${power ? 'MARCHE' : 'ARRÊT'}`);
          this.setAttr(swChild, CID.OnOff, 'onOff', power);
        }
        if (speed !== null && !isNaN(speed)) {
          currentSpeed = Math.max(0, Math.min(SPD_MAX, Math.round(speed)));
          this.setAttr(spdChild, CID.FanControl, 'percentSetting', lvToPct(currentSpeed, SPD_MAX));
          this.log.info(`[${cfg.name}] ← puissance ${currentSpeed}`);
        }
        if (fan !== null && !isNaN(fan)) {
          currentFan = Math.max(0, Math.min(FAN_MAX, Math.round(fan)));
          this.setAttr(fanChild, CID.FanControl, 'percentSetting', lvToPct(currentFan, FAN_MAX));
          this.log.info(`[${cfg.name}] ← soufflerie ${currentFan}`);
        }
      });
    }

    // Topic puissance dédié (valeur brute 0–5)
    if (cfg.speedStateTopic) {
      this.subscribe(cfg.speedStateTopic, (p) => {
        const lv = parseFloat(p);
        if (!isNaN(lv)) {
          currentSpeed = Math.max(0, Math.min(SPD_MAX, Math.round(lv)));
          this.log.info(`[${cfg.name}] ← puissance ${currentSpeed}`);
          this.setAttr(spdChild, CID.FanControl, 'percentSetting', lvToPct(currentSpeed, SPD_MAX));
        }
      });
    }

    // Topic soufflerie dédié (valeur brute 0–5)
    if (cfg.fanSpeedStateTopic) {
      this.subscribe(cfg.fanSpeedStateTopic, (p) => {
        const lv = parseFloat(p);
        if (!isNaN(lv)) {
          currentFan = Math.max(0, Math.min(FAN_MAX, Math.round(lv)));
          this.log.info(`[${cfg.name}] ← soufflerie ${currentFan}`);
          this.setAttr(fanChild, CID.FanControl, 'percentSetting', lvToPct(currentFan, FAN_MAX));
        }
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ stove composite "${cfg.name}" (switch + puissance + soufflerie)`);
  }

  // ── Occupancy sensor ───────────────────────────────────────────────────────

  private async createOccupancy(cfg: MqttDeviceConfig): Promise<void> {
    const ON  = cfg.payloadOn  ?? 'ON';
    const OFF = cfg.payloadOff ?? 'OFF';

    const ep = new matterbridge.MatterbridgeEndpoint([occupancySensor, powerSource]);
    this.initEp(ep, cfg, 0x8007);
    ep.createDefaultOccupancySensingClusterServer();

    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        const occupied = this.parseOnOff(p, ON, OFF) ?? false;
        this.log.info(`[${cfg.name}] ← ${occupied ? 'OCCUPIED' : 'CLEAR'}`);
        this.setAttr(ep, CID.OccupancySensing, 'occupancy', { occupied });
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ occupancy sensor "${cfg.name}"`);
  }

  // ── Thermostat ─────────────────────────────────────────────────────────────
  private async createThermostat(cfg: MqttDeviceConfig): Promise<void> {

    this.log.info(`[${cfg.name}] thermostatDeviceType = ${JSON.stringify(thermostatDeviceType)}`);

    const ep = new matterbridge.MatterbridgeEndpoint([
      thermostatDeviceType,
      powerSource,
    ]);

    this.initEp(ep, cfg, 0x0301);

    ep.createDefaultThermostatClusterServer(
      4,   // systemMode : Heat
      20,  // localTemperature        = 20°C  (la lib fait ×100 en interne)
      16,  // occupiedCoolingSetpoint = 16°C
      21,  // occupiedHeatingSetpoint = 21°C
    );

    // Google Home → Node-RED : diviser par 100
    ep.subscribeAttribute(
      CID.Thermostat,
      'occupiedHeatingSetpoint',
      (newValue: number) => {
        const targetC = newValue / 100;  // ← remettre / 100
        this.log.info(`[${cfg.name}] → Nouvelle consigne : ${targetC}°C`);
        if (cfg.targetTempCommandTopic)
          this.publish(cfg.targetTempCommandTopic, String(targetC), cfg.retain);
      },
      this.log,
    );
    
    if (cfg.stateTopic) {
      this.subscribe(cfg.stateTopic, (p) => {
        const c = this.parseFloatPayload(p, ['temperature', 'temp', 'local_temperature']);
        if (c !== null) {
          this.log.info(`[${cfg.name}] ← localTemperature ${c}°C`);
          this.setAttr(ep, CID.Thermostat, 'localTemperature', Math.round(c * 100));
        }
      });
    }

    if (cfg.targetTempStateTopic) {
      this.subscribe(cfg.targetTempStateTopic, (p) => {
        const c = this.parseFloatPayload(p, ['target_temperature', 'occupied_heating_setpoint']);
        if (c !== null) {
          this.log.info(`[${cfg.name}] ← occupiedHeatingSetpoint ${c}°C`);
          this.setAttr(ep, CID.Thermostat, 'occupiedHeatingSetpoint', Math.round(c * 100));
        }
        
      });
    }

    await this.registerDevice(ep);
    this.endpointMap.set(cfg.id, ep);
    this.log.info(`✓ thermostat "${cfg.name}" prêt`);
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  // Petite fonction utilitaire à ajouter dans votre classe pour simplifier le parsing
  private parseFloatPayload(payload: string, keys: string[]): number | null {
    try {
      const o = JSON.parse(payload);
      for (const key of keys) {
        if (o[key] !== undefined) return parseFloat(String(o[key]));
      }
      return parseFloat(payload);
    } catch {
      return parseFloat(payload);
    }
  }

  private parseOnOff(payload: string, on: string, off: string): boolean | null {
    if (payload === on)  return true;
    if (payload === off) return false;
    try {
      const o = JSON.parse(payload) as Record<string, unknown>;
      const s = String(o['state'] ?? o['value'] ?? o['power'] ?? '').toUpperCase();
      if (s === 'ON'  || s === '1' || s === 'TRUE')  return true;
      if (s === 'OFF' || s === '0' || s === 'FALSE') return false;
    } catch { /* pas JSON */ }
    const u = payload.toUpperCase();
    if (u === 'ON'  || u === '1' || u === 'TRUE')  return true;
    if (u === 'OFF' || u === '0' || u === 'FALSE') return false;
    this.log.warn(`parseOnOff: payload non reconnu "${payload}"`);
    return null;
  }
}