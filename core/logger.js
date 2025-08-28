// logger.js
import winston from "winston";

// 1. Define custom format
const { combine, timestamp, printf, json } = winston.format;

// Custom log format
const myFormat = printf(({ level, message, timestamp, meta }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message} ${meta ? JSON.stringify(meta) : ""}`;
});

// 2. Create logger object
const logger = winston.createLogger({
  level: "info",
  format: combine(
    timestamp(),
    myFormat    
  ),
  transports: [
    new winston.transports.Console(), // log to console
    new winston.transports.File({ filename: "logs/combined.log" }), // all logs
    new winston.transports.File({ filename: "logs/error.log", level: "error" }) // error logs only
  ]
});

export default logger;
