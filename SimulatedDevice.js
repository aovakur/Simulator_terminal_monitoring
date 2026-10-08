// client/simulator/SimulatedDevice.js — Одно симулированное устройство

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./simple-logger')('simulator-device');

class SimulatedDevice {
  constructor(deviceId, uid, config, wsUrl) {
    this.deviceId = deviceId;
    this.uid = uid;
    this.config = config;
    this.wsUrl = wsUrl;
    this.ws = null;
    this.sender = null;
    this.isConnected = false;

    // Создаём директории для устройства
    this.deviceDir = path.join(config.workDir, deviceId);
    this.inDir = path.join(this.deviceDir, 'in');
    this.outDir = path.join(this.deviceDir, 'out');

    this._createDirectories();
  }

  /**
   * Создаёт директории in/out для устройства
   */
  _createDirectories() {
    if (!fs.existsSync(this.deviceDir)) {
      fs.mkdirSync(this.deviceDir, { recursive: true });
    }
    if (!fs.existsSync(this.inDir)) {
      fs.mkdirSync(this.inDir, { recursive: true });
    }
    if (!fs.existsSync(this.outDir)) {
      fs.mkdirSync(this.outDir, { recursive: true });
    }
    logger.debug(`📁 Device directories created: ${this.deviceDir}`);
  }

  /**
   * Инициализирует ProtoCmdSender
   */
  async _initProtoSender() {
    // Импортируем классы из клиента
    const ProtoCmdSender = require('../lib/ProtoCmdSender');
    const ProtoCmd = require('../lib/ProtoCmd');
    
    await ProtoCmd.init();
    
    this.sender = new ProtoCmdSender(this.ws, logger, {
      uid: this.uid,
      deviceId: this.deviceId
    });
    
    await this.sender.ready();
    logger.debug(`ProtoCmdSender initialized for device ${this.deviceId}`);
  }

  /**
   * Подключается к серверу
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', async () => {
          this.isConnected = true;
          logger.info(`✅ Device ${this.deviceId} connected`);

          await this._initProtoSender();
          await this.sender.sendDeviceStatus();

          resolve(this);
        });

        this.ws.on('message', async (buffer) => {
          await this._handleMessage(buffer);
        });

        this.ws.on('close', () => {
          this.isConnected = false;
          logger.warn(`⚠️ Device ${this.deviceId} disconnected`);

          // Переподключение
          setTimeout(() => this.connect(), this.config.reconnectInterval);
        });

        this.ws.on('error', (err) => {
          logger.error(`❌ Device ${this.deviceId} error: ${err.message}`);
          reject(err);
        });

      } catch (err) {
        logger.error(`Failed to connect device ${this.deviceId}: ${err.message}`);
        reject(err);
      }
    });
  }

  /**
   * Обрабатывает входящие сообщения
   */
  async _handleMessage(buffer) {
    try {
      const ProtoCmd = require('../lib/ProtoCmd');
      const transportMsg = ProtoCmd.TransportMessage.decode(buffer);
      
      const payload = transportMsg.payload;
      const payloadType = Object.keys(payload)[0];
      
      if (!payloadType) {
        logger.debug(`Empty payload from device ${this.deviceId}`);
        return;
      }

      logger.debug(`📨 Device ${this.deviceId} received: ${payloadType}`);

      // Обрабатываем разные типы сообщений
      switch (payloadType) {
        case 'FilePart':
          await this._handleFilePart(payload.FilePart, transportMsg);
          break;
          
        case 'GetDeviceStatusRequest':
          await this._handleGetDeviceStatus(transportMsg);
          break;
          
        case 'CommandResponse':
          logger.debug(`CommandResponse: ${payload.CommandResponse.message}`);
          break;
          
        default:
          logger.debug(`Unhandled payload: ${payloadType}`);
      }
      
    } catch (err) {
      logger.error(`Error handling message for ${this.deviceId}: ${err.message}`);
    }
  }

  /**
   * Обрабатывает получение файла
   */
  async _handleFilePart(filePart, transportMsg) {
    const { filename, partnumber, totalparts, data, islast, hash, hashalgorithm } = filePart;
    const requestId = transportMsg.requestid;
    const cmdid = transportMsg.cmdid;
    
    logger.info(`📥 Device ${this.deviceId} receiving: ${filename} (${partnumber}/${totalparts})`);
    
    try {
      // Сохраняем часть файла в in/ директорию
      const filePath = path.join(this.inDir, filename);
      const chunkPath = `${filePath}.part${partnumber}`;
      
      fs.writeFileSync(chunkPath, Buffer.from(data));
      
      // Отправляем ACK
      if (this.sender) {
        await this.sender.sendFilePartAck(requestId, partnumber, true, '');
      }
      
      // Если это последняя часть, собираем файл
      if (islast) {
        await this._assembleFile(filename, totalparts);
        
        // Отправляем статус выполнения
        if (this.sender && cmdid) {
          await this.sender.sendCommandResponse(cmdid, 'COMPLETED', `File ${filename} received successfully`);
        }
      }
      
    } catch (err) {
      logger.error(`Error handling file part for ${this.deviceId}: ${err.message}`);
      
      if (this.sender) {
        await this.sender.sendCommandResponse(cmdid, 'FAILED', err.message);
      }
    }
  }

  /**
   * Собирает файл из частей
   */
  async _assembleFile(filename, totalParts) {
    const filePath = path.join(this.inDir, filename);
    const writeStream = fs.openSync(filePath, 'w');
    
    try {
      for (let i = 1; i <= totalParts; i++) {
        const chunkPath = `${filePath}.part${i}`;
        if (fs.existsSync(chunkPath)) {
          const data = fs.readFileSync(chunkPath);
          fs.writeSync(writeStream, data);
          fs.unlinkSync(chunkPath); // Удаляем часть после чтения
        }
      }
    } finally {
      fs.closeSync(writeStream);
    }
    
    logger.info(`✅ Device ${this.deviceId} assembled file: ${filename}`);
  }

  /**
   * Обрабатывает запрос статуса устройства
   */
  async _handleGetDeviceStatus(transportMsg) {
    logger.info(`📊 Device ${this.deviceId} sending status`);
    
    if (this.sender) {
      await this.sender.sendDeviceStatus(transportMsg);
    }
  }

  /**
   * Отключает устройство
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.isConnected = false;
    }
    logger.info(`🔌 Device ${this.deviceId} disconnected`);
  }

  /**
   * Получает статистику устройства
   */
  getStats() {
    return {
      deviceId: this.deviceId,
      uid: this.uid,
      isConnected: this.isConnected,
      inDir: this.inDir,
      outDir: this.outDir
    };
  }
}

module.exports = SimulatedDevice;
