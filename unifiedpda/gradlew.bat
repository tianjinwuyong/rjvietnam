@rem Gradle wrapper for Windows
@if "%DEBUG%"=="" @echo off
setlocal enabledelayedexpansion

set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_HOME=%DIRNAME%

set CLASSPATH=%APP_HOME%\gradle\wrapper\gradle-wrapper.jar
"%JAVA_HOME%/bin/java" -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
