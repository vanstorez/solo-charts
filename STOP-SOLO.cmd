@echo off
title Stop Solo Trading Charts
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-solo.ps1"
