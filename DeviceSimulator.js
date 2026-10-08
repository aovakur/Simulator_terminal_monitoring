// client/simulator/DeviceSimulator.js — Управление множеством симулированных устройств

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const SimulatedDevice = require('./SimulatedDevice');
const logger = require('./simple-logger')('simulator');

class DeviceSimulator {
  constructor(configPath) {
    this.config = this._loadConfig(configPath);
    this.uidPool = this._loadUidPool();
    this.devices = new Map();
    this.isRunning = false;
  }

  /**
   * Загружает пул UID из файла
   */
  _loadUidPool() {
    const uidPoolPath = path.join(__dirname, 'uid-pool.json');
    
    if (fs.existsSync(uidPoolPath)) {
      const uids = JSON.parse(fs.readFileSync(uidPoolPath, 'utf-8'));
      logger.info(`📋 Loaded ${uids.length} UIDs from pool`);
      return uids;
    }
    
    logger.warn('⚠️ UID pool not found, generating on-the-fly');
    return [];
  }

  /**
   * Получает UID из пула по индексу
   */
  _getUid(index) {
    if (index < this.uidPool.length) {
      return this.uidPool[index];
    }
    // Fallback: генерируем UID если пул закончился
    logger.warn(`UID pool exhausted at index ${index}, generating new UID`);
    return this._generateUid();
  }

  /**
   * Загружает конфигурацию
   */
  _loadConfig(configPath) {
    const defaultConfig = {
      deviceCount: 100,
      serverUrl: 'ws://localhost:3005/socket',
      reconnectInterval: 5000,
      workDir: './simulator/devices',
      logLevel: 'info',
      batchConnect: {
        enabled: true,
        batchSize: 50,
        batchDelay: 1000
      },
      autoRespond: {
        deviceStatus: true,
        fileTransfer: true,
        logRequest: true
      }
    };

    if (fs.existsSync(configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      logger.info(`📄 Config loaded from ${configPath}`);
      return { ...defaultConfig, ...fileConfig };
    }
    
    logger.warn('⚠️ Config not found, using defaults');
    return defaultConfig;
  }

  /**
   * Генерирует deviceId для устройства
   */
  _generateDeviceId(index) {
    return `sim-device-${String(index).padStart(5, '0')}`;
  }

  /**
   * Инициализирует все устройства
   */
  async _initializeDevices() {
    logger.info(`🔧 Initializing ${this.config.deviceCount} devices...`);
    
    for (let i = 1; i <= this.config.deviceCount; i++) {
      const deviceId = this._generateDeviceId(i);
      const uid = this._getUid(i - 1); // Берём UID из пула (индекс с 0)
      
      const device = new SimulatedDevice(
        deviceId,
        uid,
        this.config,
        this.config.serverUrl
      );
      
      this.devices.set(deviceId, device);
    }
    
    logger.info(`✅ ${this.config.deviceCount} devices initialized`);
    logger.info(`📊 UID pool: ${this.uidPool.length} total, using first ${this.config.deviceCount}`);
  }

  /**
   * Подключает устройства (пакетно или все сразу)
   */
  async connectDevices() {
    logger.info(`🔌 Connecting ${this.devices.size} devices...`);
    
    this.isRunning = true;
    
    if (this.config.batchConnect.enabled) {
      await this._connectInBatches();
    } else {
      await this._connectAll();
    }
    
    const connectedCount = Array.from(this.devices.values())
      .filter(d => d.isConnected).length;
    
    logger.info(`✅ Connected ${connectedCount}/${this.devices.size} devices`);
  }

  /**
   * Подключает устройства пакетами
   */
  async _connectInBatches() {
    const { batchSize, batchDelay } = this.config.batchConnect;
    const devicesArray = Array.from(this.devices.values());
    
    for (let i = 0; i < devicesArray.length; i += batchSize) {
      if (!this.isRunning) break;
      
      const batch = devicesArray.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(devicesArray.length / batchSize);
      
      logger.info(`📦 Connecting batch ${batchNum}/${totalBatches} (${batch.length} devices)...`);
      
      await Promise.allSettled(
        batch.map(device => device.connect())
      );
      
      if (i + batchSize < devicesArray.length) {
        await this._sleep(batchDelay);
      }
    }
  }

  /**
   * Подключает все устройства сразу
   */
  async _connectAll() {
    const devicesArray = Array.from(this.devices.values());
    
    await Promise.allSettled(
      devicesArray.map(device => device.connect())
    );
  }

  /**
   * Отключает все устройства
   */
  disconnectAll() {
    logger.info('🔌 Disconnecting all devices...');
    this.isRunning = false;
    
    this.devices.forEach((device, deviceId) => {
      device.disconnect();
    });
    
    this.devices.clear();
    logger.info('✅ All devices disconnected');
  }

  /**
   * Получает статистику по всем устройствам
   */
  getStats() {
    const devicesArray = Array.from(this.devices.values());
    
    const connected = devicesArray.filter(d => d.isConnected).length;
    const disconnected = devicesArray.length - connected;
    
    return {
      totalDevices: devicesArray.length,
      connected,
      disconnected,
      workDir: this.config.workDir,
      devices: devicesArray.map(d => d.getStats())
    };
  }

  /**
   * Выводит статистику в консоль
   */
  printStats() {
    const stats = this.getStats();
    
    logger.info('📊 === SIMULATOR STATS ===');
    logger.info(`   Total devices: ${stats.totalDevices}`);
    logger.info(`   Connected: ${stats.connected}`);
    logger.info(`   Disconnected: ${stats.disconnected}`);
    logger.info(`   Work directory: ${stats.workDir}`);
    logger.info('===========================');
  }

  /**
   * Сохраняет конфигурацию всех устройств в JSON
   */
  saveDevicesConfig(outputPath) {
    const devicesConfig = Array.from(this.devices.values()).map(d => ({
      deviceId: d.deviceId,
      uid: d.uid,
      isConnected: d.isConnected,
      inDir: d.inDir,
      outDir: d.outDir
    }));
    
    fs.writeFileSync(outputPath, JSON.stringify(devicesConfig, null, 2), 'utf-8');
    logger.info(`💾 Devices config saved to ${outputPath}`);
  }

  /**
   * Отправляет файл на конкретное устройство
   */
  async sendFileToDevice(deviceId, filePath) {
    const device = this.devices.get(deviceId);
    
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    
    if (!device.isConnected || !device.sender) {
      throw new Error(`Device ${deviceId} is not connected`);
    }
    
    // Копируем файл в out/ директорию устройства
    const outPath = path.join(device.outDir, path.basename(filePath));
    fs.copyFileSync(filePath, outPath);
    
    logger.info(`📤 File sent to ${deviceId}: ${outPath}`);
    return outPath;
  }

  /**
   * Вспомогательная функция для сна
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Обрабатывает SIGINT/SIGTERM
   */
  setupGracefulShutdown() {
    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down...');
      this.disconnectAll();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down...');
      this.disconnectAll();
      process.exit(0);
    });
  }
}

module.exports = DeviceSimulator;
