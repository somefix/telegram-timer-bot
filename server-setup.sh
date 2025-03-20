#!/bin/bash

# Обновление системы
sudo apt update
sudo apt upgrade -y

# Установка необходимых пакетов
sudo apt install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git

# Создание рабочей директории
sudo mkdir -p /opt/telegram-bot
sudo chown $USER:$USER /opt/telegram-bot

# Настройка файрвола
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable

# Создание сервиса для автозапуска
sudo tee /etc/systemd/system/telegram-bot.service << EOF
[Unit]
Description=Telegram Bot Docker Compose
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/telegram-bot
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

# Активация сервиса
sudo systemctl enable telegram-bot
sudo systemctl start telegram-bot 