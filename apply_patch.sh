#!/bin/zsh
set -e
cd /Users/macpro/Desktop/peakseek
pm2 restart peakseek-bot
pm2 status
