/**
 * matterbridge-mqtt — MqttPlatform
 * Compatible Matterbridge v3.x
 */
import { MatterbridgeDynamicPlatform } from 'matterbridge';
import type { PlatformMatterbridge, PlatformConfig } from 'matterbridge';
import { AnsiLogger } from 'node-ansi-logger';
export declare class MqttPlatform extends MatterbridgeDynamicPlatform {
    private mqttClient;
    private topicHandlers;
    private endpointMap;
    constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig);
    onStart(reason?: string): Promise<void>;
    onConfigure(): Promise<void>;
    onShutdown(reason?: string): Promise<void>;
    private connectMqtt;
    private subscribe;
    private publish;
    private getAttr;
    private setAttr;
    private initEp;
    private onCmd;
    private createDevice;
    private createOnOff;
    private createDimmable;
    private createColor;
    private createContact;
    private createTemp;
    private createHumidity;
    private createOccupancy;
    private parseOnOff;
}
//# sourceMappingURL=platform.d.ts.map