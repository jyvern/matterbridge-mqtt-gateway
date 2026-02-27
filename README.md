# matterbridge-mqtt

> Plugin [Matterbridge](https://github.com/Luligu/matterbridge) qui expose des **topics MQTT comme des appareils Matter virtuels**.

Idéal pour piloter des équipements via **Node-RED** (ou tout autre client MQTT) depuis Apple Home, Google Home, Amazon Alexa, Home Assistant, etc.

---

## Fonctionnement

```
[Matter Controller]          [matterbridge-mqtt]           [MQTT Broker]         [Node-RED]
  Apple Home      ──ON──►   commandTopic publish  ──►   home/plug1/set   ──►  mqtt-in node
  Google Home     ◄──ON──   stateTopic subscribe  ◄──   home/plug1/state ◄──  mqtt-out node
```

Le plugin joue un **double rôle** :
- **Matter → MQTT** : quand un contrôleur Matter envoie une commande (ON, OFF, niveau…), le plugin publie sur le `commandTopic` configuré.
- **MQTT → Matter** : quand un message arrive sur le `stateTopic`, le plugin met à jour l'état de l'appareil virtuel Matter (utile pour refléter une action physique ou une règle Node-RED).

---

## Types d'appareils supportés

| `type`           | Appareil Matter             | Clusters Matter              |
|------------------|-----------------------------|------------------------------|
| `outlet`         | Prise commandée             | OnOff                        |
| `switch`         | Interrupteur                | OnOff                        |
| `light`          | Ampoule dimmable            | OnOff + LevelControl         |
| `colorlight`     | Ampoule couleur/CT          | OnOff + Level + ColorControl |
| `contact_sensor` | Capteur d'ouverture         | BooleanState                 |
| `temperature`    | Capteur de température      | TemperatureMeasurement       |
| `humidity`       | Capteur d'humidité          | RelativeHumidityMeasurement  |
| `occupancy`      | Détecteur de présence       | OccupancySensing             |

---

## Installation

```bash
# Dans votre répertoire Matterbridge
cd ~/Matterbridge
npm install -g /chemin/vers/matterbridge-mqtt
matterbridge -add matterbridge-mqtt
matterbridge
```

Ou en développement local :

```bash
git clone <repo> matterbridge-mqtt
cd matterbridge-mqtt
npm install
npm run build
npm link
matterbridge -add matterbridge-mqtt
```

---

## Configuration

Éditez la config via le **frontend Matterbridge** (recommandé) ou directement dans `~/.matterbridge/matterbridge-mqtt.config.json`.

### Paramètres globaux

| Paramètre   | Type   | Défaut               | Description                              |
|-------------|--------|----------------------|------------------------------------------|
| `host`      | string | `mqtt://localhost`   | URL du broker MQTT (mqtt://, mqtts://)   |
| `port`      | number | `1883`               | Port TCP du broker                       |
| `username`  | string | `""`                 | Identifiant MQTT (optionnel)             |
| `password`  | string | `""`                 | Mot de passe MQTT (optionnel)            |
| `clientId`  | string | auto-généré          | ClientId MQTT                            |
| `debug`     | bool   | `false`              | Logs détaillés (topics, payloads)        |
| `devices`   | array  | `[]`                 | Liste des appareils virtuels (voir ci-dessous) |

### Paramètres par appareil

| Paramètre                 | Type   | Défaut   | Applicable à          |
|---------------------------|--------|----------|-----------------------|
| `id`                      | string | —        | Tous (obligatoire, unique) |
| `name`                    | string | —        | Tous (obligatoire)    |
| `type`                    | string | `outlet` | Tous                  |
| `stateTopic`              | string | —        | Tous                  |
| `commandTopic`            | string | —        | outlet, switch, light, colorlight |
| `payloadOn`               | string | `ON`     | outlet, switch, light, colorlight, occupancy |
| `payloadOff`              | string | `OFF`    | outlet, switch, light, colorlight |
| `retain`                  | bool   | `false`  | outlet, switch, light, colorlight |
| `brightnessStateTopic`    | string | —        | light, colorlight     |
| `brightnessCommandTopic`  | string | —        | light, colorlight     |
| `colorStateTopic`         | string | —        | colorlight            |
| `colorCommandTopic`       | string | —        | colorlight            |
| `payloadOpen`             | string | `OPEN`   | contact_sensor        |
| `payloadClosed`           | string | `CLOSED` | contact_sensor        |

---

## Exemples de configuration

### Config complète

```json
{
  "name": "matterbridge-mqtt",
  "host": "mqtt://192.168.1.10",
  "port": 1883,
  "username": "user",
  "password": "secret",
  "debug": false,
  "devices": [
    {
      "id": "plug_salon",
      "name": "Prise Salon",
      "type": "outlet",
      "stateTopic":   "home/plug/salon/state",
      "commandTopic": "home/plug/salon/set",
      "payloadOn":  "ON",
      "payloadOff": "OFF"
    },
    {
      "id": "light_bureau",
      "name": "Lampe Bureau",
      "type": "light",
      "stateTopic":             "home/light/bureau/state",
      "commandTopic":           "home/light/bureau/set",
      "brightnessStateTopic":   "home/light/bureau/brightness",
      "brightnessCommandTopic": "home/light/bureau/brightness/set"
    },
    {
      "id": "led_salon",
      "name": "LED Salon",
      "type": "colorlight",
      "stateTopic":             "home/led/salon/state",
      "commandTopic":           "home/led/salon/set",
      "brightnessStateTopic":   "home/led/salon/brightness",
      "brightnessCommandTopic": "home/led/salon/brightness/set",
      "colorStateTopic":        "home/led/salon/color",
      "colorCommandTopic":      "home/led/salon/color/set"
    },
    {
      "id": "temp_salon",
      "name": "Température Salon",
      "type": "temperature",
      "stateTopic": "home/sensor/salon/temperature"
    },
    {
      "id": "hum_salon",
      "name": "Humidité Salon",
      "type": "humidity",
      "stateTopic": "home/sensor/salon/humidity"
    },
    {
      "id": "porte_garage",
      "name": "Porte Garage",
      "type": "contact_sensor",
      "stateTopic": "home/garage/porte",
      "payloadOpen":   "OPEN",
      "payloadClosed": "CLOSED"
    },
    {
      "id": "pir_couloir",
      "name": "Présence Couloir",
      "type": "occupancy",
      "stateTopic": "home/pir/couloir"
    }
  ]
}
```

---

## Format des payloads MQTT

### Commande ON/OFF (stateTopic et commandTopic)

Le plugin accepte les formats suivants en entrée (stateTopic) :

| Format MQTT               | Interprétation |
|---------------------------|----------------|
| `ON` / `OFF`              | Standard       |
| `1` / `0`                 | Numérique      |
| `true` / `false`          | Booléen        |
| `{"state":"ON"}`          | JSON           |
| `{"value":1}`             | JSON           |
| `{"power":"ON"}`          | JSON           |

En sortie (commandTopic), le plugin publie le `payloadOn` / `payloadOff` tel que configuré (défaut `ON` / `OFF`).

### Température (stateTopic)

| Format MQTT               | Exemple        |
|---------------------------|----------------|
| Float en °C               | `21.5`         |
| JSON avec clé temperature | `{"temperature":21.5}` |
| JSON avec clé temp        | `{"temp":21.5}` |
| JSON avec clé value       | `{"value":21.5}` |

### Luminosité (brightnessStateTopic / brightnessCommandTopic)

- **Entrée** : 0–100 (%) ou 0–254 (Matter level)
- **Sortie** : 0–100 (%)

### Couleur (colorStateTopic / colorCommandTopic)

- **Entrée/Sortie JSON** : `{"hue": 240, "saturation": 100}` (hue 0–360°, sat 0–100%)
- **Température de couleur JSON** : `{"colorTemp": 370}` (mireds 153–500)

---

## Exemple Node-RED

### Recevoir une commande Matter (ON/OFF) et agir

```json
[mqtt-in: topic=home/plug/salon/set] → [switch: msg.payload === "ON"] → [action]
```

### Mettre à jour l'état Matter depuis Node-RED

```json
[trigger ou inject] → [function: msg.payload = "ON"] → [mqtt-out: topic=home/plug/salon/state]
```

### Remonter la température d'un capteur

```json
[capteur physique] → [function: msg.payload = temperature_value.toString()] → [mqtt-out: topic=home/sensor/salon/temperature]
```

---

## Dépannage

| Problème | Solution |
|----------|----------|
| L'appareil n'apparaît pas dans Apple Home | Attendre ~30s après le démarrage, ou re-scanner le QR code Matterbridge |
| L'état ne se met pas à jour | Vérifier le `stateTopic` et le format du payload avec un client MQTT (mosquitto_sub) |
| La commande ne part pas | Activer `debug: true` dans la config et vérifier les logs Matterbridge |
| Erreur de connexion MQTT | Vérifier host, port, username, password |

---

## Développement

```bash
npm run build          # Compile TypeScript → dist/
npm run build:watch    # Compilation continue
```

---

## Licence

MIT
