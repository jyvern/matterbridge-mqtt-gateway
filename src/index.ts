import { MqttPlatform } from './platform.js';

export default function (matterbridge: any, log: any, config: any): MqttPlatform {
  return new MqttPlatform(matterbridge, log, config);
}
