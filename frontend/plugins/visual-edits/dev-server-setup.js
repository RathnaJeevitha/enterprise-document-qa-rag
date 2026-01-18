// dev-server-setup.js
// Dev server middleware configuration
const fs = require("fs");
const path = require("path");
const express = require("express");

// Dev server setup function
function setupDevServer(config) {
  config.setupMiddlewares = (middlewares, devServer) => {
    if (!devServer) throw new Error("webpack-dev-server not defined");
    
    // Use built-in devServer.app for Express-like app
    const router = express.Router();
    
    // CORS origin validation - only allow localhost/127.0.0.1 for dev
    const isAllowedOrigin = (origin) => {
      if (!origin) return false;
      
      // Allow localhost and 127.0.0.1 on any port
      if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
        return true;
      }
      
      return false;
    };

    // ✅ Health check
    router.get("/ping", (req, res) => {
      res.json({ status: "ok", time: new Date().toISOString() });
    });

    // ✅ Simple file editing endpoint (optional - remove if not needed)
    router.post("/edit-file", (req, res) => {
      // Validate and set CORS headers
      const origin = req.get("Origin");
      if (origin && isAllowedOrigin(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Access-Control-Allow-Headers", "Content-Type");
      }

      const { filePath, content } = req.body;

      if (!filePath || content === undefined) {
        return res.status(400).json({ error: "filePath and content required" });
      }

      try {
        // Security check - prevent path traversal
        const frontendRoot = path.resolve(__dirname, '../..');
        const absolutePath = path.resolve(frontendRoot, filePath);
        
        // Ensure the file is within the frontend directory
        if (!absolutePath.startsWith(frontendRoot)) {
          return res.status(403).json({ error: "Forbidden path" });
        }
        
        // Prevent access to sensitive directories
        if (absolutePath.includes('node_modules') || 
            absolutePath.includes('.git') ||
            absolutePath.includes('/public/')) {
          return res.status(403).json({ error: "Forbidden path" });
        }

        // Create backup before writing (optional)
        if (fs.existsSync(absolutePath)) {
          const backupFile = absolutePath + ".backup";
          const originalContent = fs.readFileSync(absolutePath, "utf8");
          fs.writeFileSync(backupFile, originalContent, "utf8");
          
          // Clean up backup after a delay
          setTimeout(() => {
            if (fs.existsSync(backupFile)) {
              fs.unlinkSync(backupFile);
            }
          }, 5000);
        }

        // Write the updated content
        fs.writeFileSync(absolutePath, content, "utf8");

        res.json({ 
          status: "ok", 
          message: "File updated successfully",
          filePath 
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Add OPTIONS handler for CORS preflight
    router.options("/edit-file", (req, res) => {
      const origin = req.get("Origin");
      if (origin && isAllowedOrigin(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type");
        res.sendStatus(200);
      } else {
        res.sendStatus(403);
      }
    });

    // Mount the router
    devServer.app.use(router);

    return middlewares;
  };
  
  return config;
}

module.exports = setupDevServer;