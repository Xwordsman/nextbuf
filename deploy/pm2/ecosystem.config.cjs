module.exports = {
  apps: [
    {
      name: "nextbuf-web",
      cwd: "/opt/nextbuf/current",
      script: "deploy/bin/nextbuf-service",
      args: "web",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      kill_timeout: 30000,
      max_restarts: 10,
      time: true,
    },
    {
      name: "nextbuf-worker",
      cwd: "/opt/nextbuf/current",
      script: "deploy/bin/nextbuf-service",
      args: "worker",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      kill_timeout: 45000,
      max_restarts: 10,
      time: true,
    },
  ],
};
