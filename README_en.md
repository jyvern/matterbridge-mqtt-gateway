Now I have a full picture of both implementations. Here is the updated README:

---

# matterbridge-mqtt-gateway

> [Matterbridge](https://github.com/Luligu/matterbridge) plugin that exposes **MQTT topics as virtual Matter devices**.

Ideal for controlling equipment via **Node-RED** (or any other MQTT client) from Apple Home, Google Home, Amazon Alexa, Home Assistant, etc.

---

## How it works

```
[Matter Controller]          [matterbridge-mqtt-gateway]           [MQTT Broker]         [Node-RED]
  Apple Home      ──ON──►   commandTopic publish  ──►   home/plug1/set   ──►  mqtt-in node
  Google Home     ◄──ON──   stateTopic subscribe  ◄──   home/plug1/state ◄──  mqtt-out node
```

The plugin plays a **dual role**:
- **Matter → MQTT**: when a Matter controller sends a command (ON, OFF, level…), the plugin publishes to the configured `commandTopic`.
- **MQTT → Matter**: when a message arrives on the `stateTopic`, the plugin updates the state of the virtual Matter device (useful for reflecting a physical action or a Node-RED rule).

---

## Supported device types

| `type`           | Matter Device                  | Matter Clusters                      |
|------------------|--------------------------------|--------------------------------------|
| `outlet`         | Switched outlet                | OnOff                                |
| `switch`         | Switch                         | OnOff                                |
| `light`          | Dimmable bulb                  | OnOff + LevelControl                 |
| `colorlight`     | Color/CT bulb                  | OnOff + Level + ColorControl         |
| `contact_sensor` | Opening sensor                 | BooleanState                         |
| `temperature`    | Temperature sensor             | TemperatureMeasurement               |
| `humidity`       | Humidity sensor                | RelativeHumidityMeasurement          |
| `occupancy`      | Presence detector              | OccupancySensing                     |
| `stove`          | Pellet stove (composite)       | OnOff + FanControl (×2)              |
| `thermostat`     | Thermostat                     | Thermostat                           |

---

## Installation

```bash
# In your Matterbridge directory
cd ~/Matterbridge
npm install -g /path/to/matterbridge-mqtt-gateway
matterbridge -add matterbridge-mqtt-gateway
matterbridge
```

Or for local development:

```bash
git clone <repo> matterbridge-mqtt-gateway
cd matterbridge-mqtt-gateway
npm install
npm run build
npm link
matterbridge -add matterbridge-mqtt-gateway
```

---

## Configuration

Edit the config via the **Matterbridge frontend** (recommended) or directly in `~/.matterbridge/matterbridge-mqtt-gateway.config.json`.

### Global parameters

| Parameter   | Type   | Default              | Description                              |
|-------------|--------|----------------------|------------------------------------------|
| `host`      | string | `mqtt://localhost`   | MQTT broker URL (mqtt://, mqtts://)      |
| `port`      | number | `1883`               | Broker TCP port                          |
| `username`  | string | `""`                 | MQTT username (optional)                 |
| `password`  | string | `""`                 | MQTT password (optional)                 |
| `clientId`  | string | auto-generated       | MQTT ClientId                            |
| `debug`     | bool   | `false`              | Detailed logs (topics, payloads)         |
| `devices`   | array  | `[]`                 | List of virtual devices (see below)      |

### Per-device parameters

| Parameter                 | Type   | Default  | Applies to            |
|---------------------------|--------|----------|-----------------------|
| `id`                      | string | —        | All (required, unique) |
| `name`                    | string | —        | All (required)        |
| `type`                    | string | `outlet` | All                   |
| `stateTopic`              | string | —        | All                   |
| `commandTopic`            | string | —        | outlet, switch, light, colorlight, stove |
| `payloadOn`               | string | `ON`     | outlet, switch, light, colorlight, occupancy, stove |
| `payloadOff`              | string | `OFF`    | outlet, switch, light, colorlight, stove |
| `retain`                  | bool   | `false`  | outlet, switch, light, colorlight, stove, thermostat |
| `brightnessStateTopic`    | string | —        | light, colorlight     |
| `brightnessCommandTopic`  | string | —        | light, colorlight     |
| `colorStateTopic`         | string | —        | colorlight            |
| `colorCommandTopic`       | string | —        | colorlight            |
| `payloadOpen`             | string | `OPEN`   | contact_sensor        |
| `payloadClosed`           | string | `CLOSED` | contact_sensor        |
| `speedStateTopic`         | string | —        | stove                 |
| `speedCommandTopic`       | string | —        | stove                 |
| `speedStepTopic`          | string | —        | stove                 |
| `fanSpeedStateTopic`      | string | —        | stove                 |
| `fanSpeedStepTopic`       | string | —        | stove                 |
| `speedMin`                | number | `1`      | stove                 |
| `speedMax`                | number | `5`      | stove                 |
| `targetTempStateTopic`    | string | —        | thermostat            |
| `targetTempCommandTopic`  | string | —        | thermostat            |

---

## Configuration examples

### Full config

```json
{
  "name": "matterbridge-mqtt-gateway",
  "host": "mqtt://192.168.1.10",
  "port": 1883,
  "username": "user",
  "password": "secret",
  "debug": false,
  "devices": [
    {
      "id": "plug_living_room",
      "name": "Living Room Outlet",
      "type": "outlet",
      "stateTopic":   "home/plug/living_room/state",
      "commandTopic": "home/plug/living_room/set",
      "payloadOn":  "ON",
      "payloadOff": "OFF"
    },
    {
      "id": "light_office",
      "name": "Office Light",
      "type": "light",
      "stateTopic":             "home/light/office/state",
      "commandTopic":           "home/light/office/set",
      "brightnessStateTopic":   "home/light/office/brightness",
      "brightnessCommandTopic": "home/light/office/brightness/set"
    },
    {
      "id": "led_living_room",
      "name": "Living Room LED",
      "type": "colorlight",
      "stateTopic":             "home/led/living_room/state",
      "commandTopic":           "home/led/living_room/set",
      "brightnessStateTopic":   "home/led/living_room/brightness",
      "brightnessCommandTopic": "home/led/living_room/brightness/set",
      "colorStateTopic":        "home/led/living_room/color",
      "colorCommandTopic":      "home/led/living_room/color/set"
    },
    {
      "id": "temp_living_room",
      "name": "Living Room Temperature",
      "type": "temperature",
      "stateTopic": "home/sensor/living_room/temperature"
    },
    {
      "id": "hum_living_room",
      "name": "Living Room Humidity",
      "type": "humidity",
      "stateTopic": "home/sensor/living_room/humidity"
    },
    {
      "id": "garage_door",
      "name": "Garage Door",
      "type": "contact_sensor",
      "stateTopic": "home/garage/door",
      "payloadOpen":   "OPEN",
      "payloadClosed": "CLOSED"
    },
    {
      "id": "pir_hallway",
      "name": "Hallway Presence",
      "type": "occupancy",
      "stateTopic": "home/pir/hallway"
    },
    {
      "id": "pellet_stove",
      "name": "Pellet Stove",
      "type": "stove",
      "stateTopic":          "home/stove/state",
      "commandTopic":        "home/stove/set",
      "speedStateTopic":     "home/stove/speed",
      "speedCommandTopic":   "home/stove/speed/set",
      "speedStepTopic":      "home/stove/speed/step",
      "fanSpeedStateTopic":  "home/stove/fan",
      "fanSpeedStepTopic":   "home/stove/fan/step",
      "speedMin": 1,
      "speedMax": 5
    },
    {
      "id": "living_room_thermostat",
      "name": "Living Room Thermostat",
      "type": "thermostat",
      "stateTopic":              "home/thermostat/living_room/temperature",
      "targetTempStateTopic":    "home/thermostat/living_room/target",
      "targetTempCommandTopic":  "home/thermostat/living_room/target/set"
    }
  ]
}
```

---

## MQTT payload formats

### ON/OFF command (stateTopic and commandTopic)

The plugin accepts the following input formats (stateTopic):

| MQTT format               | Interpretation |
|---------------------------|----------------|
| `ON` / `OFF`              | Standard       |
| `1` / `0`                 | Numeric        |
| `true` / `false`          | Boolean        |
| `{"state":"ON"}`          | JSON           |
| `{"value":1}`             | JSON           |
| `{"power":"ON"}`          | JSON           |

On output (commandTopic), the plugin publishes the configured `payloadOn` / `payloadOff` as-is (default `ON` / `OFF`).

### Temperature (stateTopic)

| MQTT format               | Example        |
|---------------------------|----------------|
| Float in °C               | `21.5`         |
| JSON with temperature key | `{"temperature":21.5}` |
| JSON with temp key        | `{"temp":21.5}` |
| JSON with value key       | `{"value":21.5}` |

### Brightness (brightnessStateTopic / brightnessCommandTopic)

- **Input**: 0–100 (%) or 0–254 (Matter level)
- **Output**: 0–100 (%)

### Color (colorStateTopic / colorCommandTopic)

- **Input/Output JSON**: `{"hue": 240, "saturation": 100}` (hue 0–360°, sat 0–100%)
- **Color temperature JSON**: `{"colorTemp": 370}` (mireds 153–500)

### Stove (stateTopic, speedStateTopic, fanSpeedStateTopic)

The main `stateTopic` accepts a plain ON/OFF payload or a combined JSON object:

| MQTT format | Example |
|---|---|
| Plain ON/OFF | `ON` / `OFF` |
| Combined JSON | `{"power":"ON","speed":3,"fan":2}` |

The dedicated speed topics accept raw numeric values:

| Topic | Format | Example |
|---|---|---|
| `speedStateTopic` | Integer 0–`speedMax` | `3` |
| `fanSpeedStateTopic` | Integer 0–5 | `2` |
| `speedStepTopic` | Relative increment | `+1` / `-1` |
| `fanSpeedStepTopic` | Relative increment | `+1` / `-1` |

Matter maps speed levels to percentages internally (level / max × 100). For example, with `speedMax: 5`, level 3 becomes 60%.

### Thermostat (stateTopic, targetTempStateTopic, targetTempCommandTopic)

| Topic | Direction | Format | Example |
|---|---|---|---|
| `stateTopic` | MQTT → Matter | Float °C or JSON | `21.5` or `{"temperature":21.5}` |
| `targetTempStateTopic` | MQTT → Matter | Float °C or JSON | `20.0` or `{"target_temperature":20.0}` |
| `targetTempCommandTopic` | Matter → MQTT | Float °C (string) | `"21.0"` |

The thermostat operates in **Heat** mode. The setpoint reported to `targetTempCommandTopic` is the `occupiedHeatingSetpoint` attribute, expressed in °C.

---

## Node-RED examples

### Receive a Matter command (ON/OFF) and act on it

```json
[mqtt-in: topic=home/plug/living_room/set] → [switch: msg.payload === "ON"] → [action]
```

### Update Matter state from Node-RED

```json
[trigger or inject] → [function: msg.payload = "ON"] → [mqtt-out: topic=home/plug/living_room/state]
```

### Push temperature from a sensor

```json
[physical sensor] → [function: msg.payload = temperature_value.toString()] → [mqtt-out: topic=home/sensor/living_room/temperature]
```

### Control a pellet stove from Node-RED

```json
[inject: ON] → [mqtt-out: topic=home/stove/set]
[inject: 3]  → [mqtt-out: topic=home/stove/speed/set]
[inject: +1] → [mqtt-out: topic=home/stove/fan/step]
```

### Update thermostat target from Node-RED

```json
[inject: 21.5] → [function: msg.payload = String(msg.payload)] → [mqtt-out: topic=home/thermostat/living_room/target]
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Device doesn't appear in Apple Home | Wait ~30s after startup, or re-scan the Matterbridge QR code |
| State is not updating | Check the `stateTopic` and payload format with an MQTT client (mosquitto_sub) |
| Command is not sent | Enable `debug: true` in the config and check the Matterbridge logs |
| MQTT connection error | Check host, port, username, password |
| Thermostat setpoint not applied | Make sure the value on `targetTempStateTopic` is in °C — the plugin multiplies by 100 internally |
| Stove speed not updating | Verify `speedMax` matches your device's actual range; check raw values with mosquitto_sub |

---

## Development

```bash
npm run build          # Compile TypeScript → dist/
npm run build:watch    # Continuous compilation
```

---

## License

MIT
