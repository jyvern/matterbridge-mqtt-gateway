declare module 'matterbridge' {
  export type PlatformMatterbridge = Record<string, any>;
  export type PlatformConfig = Record<string, any>;

  export class MatterbridgeEndpoint {
    constructor(deviceTypes?: any[]);
    createDefaultBasicInformationClusterServer(name: string, serial: string, vendorId: number, vendorName: string, productId: number, productName: string): void;
    createDefaultIdentifyClusterServer(): void;
    createDefaultOnOffClusterServer(): void;
    createDefaultLevelControlClusterServer(): void;
    createDefaultColorControlClusterServer(): void;
    createDefaultBooleanStateClusterServer(value: boolean): void;
    createDefaultTemperatureMeasurementClusterServer(value: number): void;
    createDefaultRelativeHumidityMeasurementClusterServer(value: number): void;
    createDefaultOccupancySensingClusterServer(): void;
    createDefaultWindowCoveringClusterServer(): void;
    createDefaultFanControlClusterServer(fanMode?: number, fanModeSequence?: number, percentSetting?: number, percentCurrent?: number): void;
    createMultiSpeedFanControlClusterServer(fanMode?: number, fanModeSequence?: number, percentSetting?: number, percentCurrent?: number, speedMax?: number, speedSetting?: number): void;
    addCommandHandler(cmd: string, handler: (data: any) => void | Promise<void>): void;
    [key: string]: any;
  }

  export class MatterbridgeDynamicPlatform {
    protected log: import('node-ansi-logger').AnsiLogger;
    protected config: PlatformConfig;
    constructor(matterbridge: PlatformMatterbridge, log: import('node-ansi-logger').AnsiLogger, config: PlatformConfig);
    registerDevice(ep: MatterbridgeEndpoint): Promise<void>;
    onStart?(reason?: string): Promise<void>;
    onConfigure?(): Promise<void>;
    onShutdown?(reason?: string): Promise<void>;
  }

  export const onOffOutlet: any;
  export const onOffSwitch: any;
  export const dimmableLight: any;
  export const colorTemperatureLight: any;
  export const contactSensor: any;
  export const temperatureSensor: any;
  export const humiditySensor: any;
  export const occupancySensor: any;
  export const coverDevice: any;
  export const fanDevice: any;
  export const aggregator: any;
  export const bridgedNode: any;
  export const powerSource: any;

  export function getAttribute(ep: MatterbridgeEndpoint, clusterId: any, attr: string, log: any): any;
  export function setAttribute(ep: MatterbridgeEndpoint, clusterId: any, attr: string, value: any, log: any): void;
}

declare module 'node-ansi-logger' {
  export class AnsiLogger {
    constructor(opts?: Record<string, any>);
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
    [key: string]: any;
  }
}
