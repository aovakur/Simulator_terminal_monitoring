#!/usr/bin/env node
// client/simulator/run-simulator.js — Запуск симулятора устройств

const path = require('path');
const DeviceSimulator = require('./DeviceSimulator');
const logger = require('./simple-logger')('simulator-main');

async function main() {
  const configPath = path.join(__dirname, 'simulator-config.json');
  
  logger.info('🚀 Starting Device Simulator...');
  logger.info(`📄 Config: ${configPath}`);
  
  // Создаём симулятор
  const simulator = new DeviceSimulator(configPath);
  
  // Настраиваем graceful shutdown
  simulator.setupGracefulShutdown();
  
  try {
    // Инициализируем устройства
    await simulator._initializeDevices();
    
    // Подключаем устройства
    await simulator.connectDevices();
    
    // Выводим статистику
    simulator.printStats();
    
    // Периодически выводим статистику каждые 30 секунд
    setInterval(() => {
      simulator.printStats();
    }, 30000);
    
    logger.info('✅ Simulator is running. Press Ctrl+C to stop.');
    
  } catch (err) {
    logger.error(`❌ Failed to start simulator: ${err.message}`, err);
    process.exit(1);
  }
}

// Запускаем
main().catch(err => {
  logger.error(`Fatal error: ${err.message}`, err);
  process.exit(1);
});
