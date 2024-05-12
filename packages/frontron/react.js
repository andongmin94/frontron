// Electron Modules
const path = require('node:path');
const electronLocalshortcut = require("electron-localshortcut");
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require("electron");

// Web Modules
const axios = require("axios");
const https = require("https");

// Environment Variable Setup
require('dotenv').config();
const PORT = process.env.NODE_ENV === 'development' ? 3000 : 1994;

// Local Web Server Modules
const express = require('express');
const server = express();

// Serving the build files when not in development mode
if (process.env.NODE_ENV !== 'development') {
  // Serve build files
  server.use(express.static(path.join(__dirname, '../../dist')));

  // Handle root path requests
  server.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../dist', 'index.html'));
  });

  // Start server
  server.listen(PORT, () => {}).on('error', (err) => {
    // If the port is already in use, retry on a different port
    if (err.code === 'EADDRINUSE') {
      PORT += 1; // Increment port number
      setTimeout(() => {
        server.listen(PORT);
      }, 1000); // Retry after 1 second
    }
  });
}

// Set up shortcuts for debugging in development mode
if (process.env.NODE_ENV === 'development') {
  // F5 for reload, F12 for opening the developer tools
  electronLocalshortcut.register("F5", () => { console.log('F5 is pressed'); mainWindow.reload() });
  electronLocalshortcut.register("F12", () => { console.log("F12 is pressed"); mainWindow.webContents.toggleDevTools() });
}

// Electron create function
let mainWindow;
const createWindow = () => {
  // Create browser window
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    frame: false,
    icon: path.join(__dirname, "../../public/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  // Connect to port
  mainWindow.loadURL(`http://localhost:${PORT}`);
}

// Create browser window after Electron initialization is complete
app.whenReady().then(createWindow).then(() => {
  // Default setup
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit() });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() });

  // Title bar options
  ipcMain.on("hidden", () => mainWindow.hide());
  ipcMain.on("minimize", () => mainWindow.minimize());
  ipcMain.on("maximize", () => {
    mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize();
  });
  
  // Tray settings
  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "../../public/icon.png")));
  tray.setToolTip("frontron");
  tray.on("double-click", () => mainWindow.show());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open", type: "normal", click: () => mainWindow.show() },
    { label: "Quit", type: "normal", click: () => app.quit() }
  ]));
});

module.exports = { mainWindow };