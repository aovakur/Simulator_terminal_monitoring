// client/simulator/simple-logger.js — Простой логгер для симулятора (без зависимостей от config)

class SimpleLogger {
  constructor(category) {
    this.category = category;
  }

  _formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    return `${timestamp} [${level}] [${this.category}] ${message} ${formattedArgs}`.trim();
  }

  error(message, ...args) {
    console.error(this._formatMessage('ERROR', message, ...args));
  }

  warn(message, ...args) {
    console.warn(this._formatMessage('WARN', message, ...args));
  }

  info(message, ...args) {
    console.info(this._formatMessage('INFO', message, ...args));
  }

  debug(message, ...args) {
    if (process.env.DEBUG) {
      console.log(this._formatMessage('DEBUG', message, ...args));
    }
  }
}

// Factory function
function createLogger(category) {
  return new SimpleLogger(category);
}

module.exports = createLogger;
