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

# Установка Docker и Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
sudo apt install -y docker-compose-plugin

# Перезапуск Docker и проверка статуса
sudo systemctl restart docker
sudo systemctl enable docker
sudo systemctl status docker --no-pager

# Создание рабочей директории
sudo mkdir -p /home/deploy/telegram-timer-bot
sudo chown $USER:$USER /home/deploy/telegram-timer-bot

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
WorkingDirectory=/home/deploy/telegram-timer-bot
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

# Активация сервиса
sudo systemctl enable telegram-bot
sudo systemctl start telegram-bot 