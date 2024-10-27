#!/bin/bash

cp power.service /etc/systemd/system/
cp power.conf /etc/logrotate.d/
cp power-logging.yml /etc/newrelic-infra/logging.d/
systemctl daemon-reload
