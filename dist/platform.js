/**
 * matterbridge-mqtt — MqttPlatform
 * Compatible Matterbridge v3.x
 */
// ── Matterbridge ──────────────────────────────────────────────────────────────
import { MatterbridgeDynamicPlatform, MatterbridgeEndpoint, onOffOutlet, onOffSwitch, dimmableLight, colorTemperatureLight, contactSensor, temperatureSensor, humiditySensor, occupancySensor, powerSource, getAttribute, setAttribute, } from 'matterbridge';
// ── MQTT ──────────────────────────────────────────────────────────────────────
import mqtt from 'mqtt';
// ── Cluster IDs Matter ───────────────────────────────────────────────────────
const CID = {
    OnOff: 0x0006,
    LevelControl: 0x0008,
    ColorControl: 0x0300,
    BooleanState: 0x0045,
    TemperatureMeasurement: 0x0402,
    RelativeHumidityMeasurement: 0x0405,
    OccupancySensing: 0x0406,
};
// ── Platform ──────────────────────────────────────────────────────────────────
export class MqttPlatform extends MatterbridgeDynamicPlatform {
    mqttClient;
    topicHandlers = new Map();
    endpointMap = new Map();
    constructor(matterbridge, log, config) {
        super(matterbridge, log, config);
        this.log.info('MqttPlatform created');
    }
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    async onStart(reason) {
        this.log.info(`onStart: ${reason ?? '-'}`);
        await this.connectMqtt();
        const devices = this.config['devices'] ?? [];
        if (!devices.length) {
            this.log.warn('No devices configured.');
            return;
        }
        for (const cfg of devices) {
            try {
                await this.createDevice(cfg);
            }
            catch (err) {
                this.log.error(`Device "${cfg.id}" failed: ${err}`);
            }
        }
    }
    async onConfigure() {
        this.log.info('onConfigure: all devices ready');
    }
    async onShutdown(reason) {
        this.log.info(`onShutdown: ${reason ?? '-'}`);
        if (this.mqttClient?.connected) {
            await this.mqttClient.endAsync();
            this.log.info('MQTT disconnected');
        }
    }
    // ── MQTT ───────────────────────────────────────────────────────────────────
    async connectMqtt() {
        const host = this.config['host'] ?? 'mqtt://localhost';
        const port = this.config['port'] ?? 1883;
        const username = this.config['username'] ?? '';
        const password = this.config['password'] ?? '';
        const clientId = this.config['clientId'] ??
            `mb_mqtt_${Math.random().toString(16).slice(2, 8)}`;
        const opts = {
            port, clientId,
            clean: true, reconnectPeriod: 5000, connectTimeout: 10_000,
        };
        if (username)
            opts.username = username;
        if (password)
            opts.password = password;
        this.log.info(`MQTT → ${host}:${port} [${clientId}]`);
        return new Promise((resolve, reject) => {
            this.mqttClient = mqtt.connect(host, opts);
            this.mqttClient.once('connect', () => { this.log.info('MQTT connected ✓'); resolve(); });
            this.mqttClient.once('error', (e) => { this.log.error(`MQTT error: ${e.message}`); reject(e); });
            this.mqttClient.on('reconnect', () => this.log.warn('MQTT reconnecting…'));
            this.mqttClient.on('message', (topic, buf) => {
                const payload = buf.toString().trim();
                if (this.config['debug'])
                    this.log.debug(`← [${topic}] ${payload}`);
                this.topicHandlers.get(topic)?.forEach(h => {
                    try {
                        h(payload);
                    }
                    catch (e) {
                        this.log.error(`Handler [${topic}]: ${e}`);
                    }
                });
            });
        });
    }
    subscribe(topic, handler) {
        if (!this.mqttClient)
            return;
        const list = this.topicHandlers.get(topic);
        if (list) {
            list.push(handler);
            return;
        }
        this.topicHandlers.set(topic, [handler]);
        this.mqttClient.subscribe(topic, (err) => {
            if (err)
                this.log.error(`Subscribe failed [${topic}]: ${err.message}`);
            else if (this.config['debug'])
                this.log.debug(`subscribed → ${topic}`);
        });
    }
    publish(topic, payload, retain = false) {
        if (!this.mqttClient?.connected) {
            this.log.warn(`Not connected, skip [${topic}]`);
            return;
        }
        this.mqttClient.publish(topic, payload, { retain, qos: 1 });
        if (this.config['debug'])
            this.log.debug(`→ [${topic}] ${payload}`);
    }
    // ── Helpers ────────────────────────────────────────────────────────────────
    getAttr(ep, clusterId, attr) {
        return getAttribute(ep, clusterId, attr, this.log);
    }
    setAttr(ep, clusterId, attr, value) {
        void setAttribute(ep, clusterId, attr, value, this.log);
    }
    initEp(ep, cfg, productId) {
        ep.createDefaultBasicInformationClusterServer(cfg.name, `mqtt-${cfg.id}`, 0xfff1, 'MQTT-Bridge', productId, 'matterbridge-mqtt');
        ep.createDefaultIdentifyClusterServer();
    }
    onCmd(ep, cmd, fn) {
        ep.addCommandHandler(cmd, fn);
    }
    // ── Device factory ─────────────────────────────────────────────────────────
    async createDevice(cfg) {
        switch (cfg.type ?? 'outlet') {
            case 'outlet': return this.createOnOff(cfg, onOffOutlet, 0x8000);
            case 'switch': return this.createOnOff(cfg, onOffSwitch, 0x8001);
            case 'light': return this.createDimmable(cfg);
            case 'colorlight': return this.createColor(cfg);
            case 'contact_sensor': return this.createContact(cfg);
            case 'temperature': return this.createTemp(cfg);
            case 'humidity': return this.createHumidity(cfg);
            case 'occupancy': return this.createOccupancy(cfg);
            default: this.log.warn(`Unknown type "${cfg.type}" — skipping "${cfg.id}"`);
        }
    }
    // ── OnOff — outlet / switch ────────────────────────────────────────────────
    async createOnOff(cfg, devType, pid) {
        const ON = cfg.payloadOn ?? 'ON';
        const OFF = cfg.payloadOff ?? 'OFF';
        const ep = new MatterbridgeEndpoint([devType, powerSource]);
        this.initEp(ep, cfg, pid);
        ep.createDefaultOnOffClusterServer();
        this.onCmd(ep, 'on', async () => {
            this.log.info(`[${cfg.name}] → ON`);
            if (cfg.commandTopic)
                this.publish(cfg.commandTopic, ON, cfg.retain);
        });
        this.onCmd(ep, 'off', async () => {
            this.log.info(`[${cfg.name}] → OFF`);
            if (cfg.commandTopic)
                this.publish(cfg.commandTopic, OFF, cfg.retain);
        });
        this.onCmd(ep, 'toggle', async () => {
            const cur = this.getAttr(ep, CID.OnOff, 'onOff') ?? false;
            this.log.info(`[${cfg.name}] → TOGGLE (was ${cur ? 'ON' : 'OFF'})`);
            if (cfg.commandTopic)
                this.publish(cfg.commandTopic, cur ? OFF : ON, cfg.retain);
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
    async createDimmable(cfg) {
        const ON = cfg.payloadOn ?? 'ON';
        const OFF = cfg.payloadOff ?? 'OFF';
        const ep = new MatterbridgeEndpoint([dimmableLight, powerSource]);
        this.initEp(ep, cfg, 0x8002);
        ep.createDefaultOnOffClusterServer();
        ep.createDefaultLevelControlClusterServer();
        this.onCmd(ep, 'on', async () => { if (cfg.commandTopic)
            this.publish(cfg.commandTopic, ON, cfg.retain); });
        this.onCmd(ep, 'off', async () => { if (cfg.commandTopic)
            this.publish(cfg.commandTopic, OFF, cfg.retain); });
        const levelHandler = async (data) => {
            const lv254 = data.request.level;
            const lv100 = Math.round((lv254 / 254) * 100);
            this.log.info(`[${cfg.name}] → level ${lv254} (${lv100}%)`);
            if (cfg.brightnessCommandTopic)
                this.publish(cfg.brightnessCommandTopic, String(lv100), cfg.retain);
            if (cfg.commandTopic)
                this.publish(cfg.commandTopic, lv254 > 0 ? ON : OFF, cfg.retain);
        };
        this.onCmd(ep, 'moveToLevel', levelHandler);
        this.onCmd(ep, 'moveToLevelWithOnOff', levelHandler);
        if (cfg.stateTopic) {
            this.subscribe(cfg.stateTopic, (p) => {
                const v = this.parseOnOff(p, ON, OFF);
                if (v !== null)
                    this.setAttr(ep, CID.OnOff, 'onOff', v);
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
    async createColor(cfg) {
        const ON = cfg.payloadOn ?? 'ON';
        const OFF = cfg.payloadOff ?? 'OFF';
        const ep = new MatterbridgeEndpoint([colorTemperatureLight, powerSource]);
        this.initEp(ep, cfg, 0x8003);
        ep.createDefaultOnOffClusterServer();
        ep.createDefaultLevelControlClusterServer();
        ep.createDefaultColorControlClusterServer();
        this.onCmd(ep, 'on', async () => { if (cfg.commandTopic)
            this.publish(cfg.commandTopic, ON, cfg.retain); });
        this.onCmd(ep, 'off', async () => { if (cfg.commandTopic)
            this.publish(cfg.commandTopic, OFF, cfg.retain); });
        const levelHandler = async (data) => {
            const lv100 = Math.round((data.request.level / 254) * 100);
            if (cfg.brightnessCommandTopic)
                this.publish(cfg.brightnessCommandTopic, String(lv100), cfg.retain);
        };
        this.onCmd(ep, 'moveToLevel', levelHandler);
        this.onCmd(ep, 'moveToLevelWithOnOff', levelHandler);
        this.onCmd(ep, 'moveToHueAndSaturation', (async (data) => {
            const hue360 = Math.round((data.request.hue / 254) * 360);
            const sat100 = Math.round((data.request.saturation / 254) * 100);
            this.log.info(`[${cfg.name}] → H${hue360}° S${sat100}%`);
            if (cfg.colorCommandTopic)
                this.publish(cfg.colorCommandTopic, JSON.stringify({ hue: hue360, saturation: sat100 }), cfg.retain);
        }));
        this.onCmd(ep, 'moveToColorTemperature', (async (data) => {
            const mireds = data.request.colorTemperatureMireds;
            this.log.info(`[${cfg.name}] → ${mireds} mireds`);
            if (cfg.colorCommandTopic)
                this.publish(cfg.colorCommandTopic, JSON.stringify({ colorTemp: mireds }), cfg.retain);
        }));
        if (cfg.stateTopic) {
            this.subscribe(cfg.stateTopic, (p) => {
                const v = this.parseOnOff(p, ON, OFF);
                if (v !== null)
                    this.setAttr(ep, CID.OnOff, 'onOff', v);
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
                    const d = JSON.parse(p);
                    if (d['hue'] !== undefined)
                        this.setAttr(ep, CID.ColorControl, 'currentHue', Math.round((d['hue'] / 360) * 254));
                    if (d['saturation'] !== undefined)
                        this.setAttr(ep, CID.ColorControl, 'currentSaturation', Math.round((d['saturation'] / 100) * 254));
                    if (d['colorTemp'] !== undefined)
                        this.setAttr(ep, CID.ColorControl, 'colorTemperatureMireds', d['colorTemp']);
                }
                catch {
                    const m = parseInt(p, 10);
                    if (!isNaN(m))
                        this.setAttr(ep, CID.ColorControl, 'colorTemperatureMireds', m);
                }
            });
        }
        await this.registerDevice(ep);
        this.endpointMap.set(cfg.id, ep);
        this.log.info(`✓ color light "${cfg.name}"`);
    }
    // ── Contact sensor ─────────────────────────────────────────────────────────
    async createContact(cfg) {
        const OPEN = cfg.payloadOpen ?? 'OPEN';
        const CLOSED = cfg.payloadClosed ?? 'CLOSED';
        const ep = new MatterbridgeEndpoint([contactSensor, powerSource]);
        this.initEp(ep, cfg, 0x8004);
        ep.createDefaultBooleanStateClusterServer(true);
        if (cfg.stateTopic) {
            this.subscribe(cfg.stateTopic, (p) => {
                let contact;
                if (p === OPEN)
                    contact = false;
                else if (p === CLOSED)
                    contact = true;
                else {
                    const l = p.toLowerCase();
                    contact = l === '1' || l === 'true' || l === 'closed';
                }
                this.log.info(`[${cfg.name}] ← ${contact ? 'CLOSED' : 'OPEN'}`);
                this.setAttr(ep, CID.BooleanState, 'stateValue', contact);
            });
        }
        await this.registerDevice(ep);
        this.endpointMap.set(cfg.id, ep);
        this.log.info(`✓ contact sensor "${cfg.name}"`);
    }
    // ── Temperature sensor ─────────────────────────────────────────────────────
    async createTemp(cfg) {
        const ep = new MatterbridgeEndpoint([temperatureSensor, powerSource]);
        this.initEp(ep, cfg, 0x8005);
        ep.createDefaultTemperatureMeasurementClusterServer(2000);
        if (cfg.stateTopic) {
            this.subscribe(cfg.stateTopic, (p) => {
                let c = null;
                try {
                    const o = JSON.parse(p);
                    c = parseFloat(String(o['temperature'] ?? o['temp'] ?? o['value'] ?? ''));
                }
                catch {
                    c = parseFloat(p);
                }
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
    async createHumidity(cfg) {
        const ep = new MatterbridgeEndpoint([humiditySensor, powerSource]);
        this.initEp(ep, cfg, 0x8006);
        ep.createDefaultRelativeHumidityMeasurementClusterServer(5000);
        if (cfg.stateTopic) {
            this.subscribe(cfg.stateTopic, (p) => {
                let h = null;
                try {
                    const o = JSON.parse(p);
                    h = parseFloat(String(o['humidity'] ?? o['value'] ?? ''));
                }
                catch {
                    h = parseFloat(p);
                }
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
    // ── Occupancy sensor ───────────────────────────────────────────────────────
    async createOccupancy(cfg) {
        const ON = cfg.payloadOn ?? 'ON';
        const OFF = cfg.payloadOff ?? 'OFF';
        const ep = new MatterbridgeEndpoint([occupancySensor, powerSource]);
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
    // ── Utility ────────────────────────────────────────────────────────────────
    parseOnOff(payload, on, off) {
        if (payload === on)
            return true;
        if (payload === off)
            return false;
        try {
            const o = JSON.parse(payload);
            const s = String(o['state'] ?? o['value'] ?? o['power'] ?? '').toUpperCase();
            if (s === 'ON' || s === '1' || s === 'TRUE')
                return true;
            if (s === 'OFF' || s === '0' || s === 'FALSE')
                return false;
        }
        catch { /* pas JSON */ }
        const u = payload.toUpperCase();
        if (u === 'ON' || u === '1' || u === 'TRUE')
            return true;
        if (u === 'OFF' || u === '0' || u === 'FALSE')
            return false;
        this.log.warn(`parseOnOff: payload non reconnu "${payload}"`);
        return null;
    }
}
//# sourceMappingURL=platform.js.map