@echo off
if not exist "%~dp0.local" mkdir "%~dp0.local"
type nul > "%~dp0.local\stop-publish"
