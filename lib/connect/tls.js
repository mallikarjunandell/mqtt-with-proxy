'use strict'
var tls = require('tls')
var debug = require('debug')('mqttjs:tls')
const http = require('http')
const SocksClient = require('socks').SocksClient

async function buildBuilder (mqttClient, opts) {
  return new Promise(async (resolve, reject) => {
    opts.port = opts.port || 8443
    opts.host = opts.hostname || opts.host || 'localhost'
    opts.servername = opts.host
    opts.rejectUnauthorized = false
    if (opts.rejectUnauthorized === 'true' || opts.rejectUnauthorized === true) {
      opts.rejectUnauthorized = true
    }
    delete opts.path
    console.log('port %d host %s rejectUnauthorized %b', opts.port, opts.host, opts.rejectUnauthorized)
    if (opts.proxy) {
      console.log('[MQTT] Entered into TLS connection proxy streambuilder')
      let proxy = opts.proxy
      try {
        let proxySocket = ''
        if (proxy.proxyType === 'https' || proxy.proxyType === 'http') {
          proxySocket = await createSocket(opts, mqttClient)
          console.log('Creating HTTP/HTTPS proxy socket for MQTT')
        } else if (proxy.proxyType === 'socks') {
          proxySocket = await createSocksSocket(opts, mqttClient)
          console.log('Creating SOCKS proxy socket for MQTT')
        } else {
          proxySocket = await createSocket(opts, mqttClient)
        }
        let options = opts
        let tlsOptions = mergeOptions({}, proxy, {
          socket: proxySocket,
          servername: options.host
        })
        tlsOptions.rejectUnauthorized = opts.rejectUnauthorized
        if (proxySocket) {
          console.log('Received proper proxy socket. Printing TLS options')
        }
        console.log(tlsOptions)
        let secureSocket = tls.connect(tlsOptions)
        console.log('Starting the listeners for the MQTT proxy socket')
        let handleTLSerrors1 = function (err) {
          if (opts.rejectUnauthorized) {
            mqttClient.emit('error', err)
          }
          secureSocket.end()
        }

        secureSocket.on('secureConnect', () => {
          if (opts.rejectUnauthorized === true && secureSocket.authorized === false) {
            secureSocket.emit('error', 'NOT_AUTHORIZED')
          } else {
            secureSocket.removeListener('error', handleTLSerrors1)
          }
        })

        secureSocket.on('error', handleTLSerrors1)
        resolve(secureSocket)
      } catch (err) {
        console.log(err)
        reject(err)
      }
    } else {
      console.log('[MQTT] No proxy details found for MQTT. Creating direct connection')
      let connection = tls.connect(opts)
      console.log('Logging direct secure MQTT connection options')
      console.log(opts)
      opts.rejectUnauthorized = false;
      let handleTLSerrors = ''
      connection.on('secureConnect', function () {
        if (opts.rejectUnauthorized && !connection.authorized) {
          connection.emit('error', 'NOT_AUTHORIZED')
        } else {
          connection.removeListener('error', handleTLSerrors)
        }
      })

      handleTLSerrors = function (err) {
        // How can I get verify this error is a tls error?
        if (opts.rejectUnauthorized) {
          mqttClient.emit('error', err)
        }

        // close this connection to match the behaviour of net
        // otherwise all we get is an error from the connection
        // and close event doesn't fire. This is a work around
        // to enable the reconnect code to work the same as with
        // net.createConnection
        connection.end()
      }
      connection.on('error', handleTLSerrors)
      resolve(connection)
    }
  })
}

function mergeOptions (target) {
  for (var i = 1, len = arguments.length; i < len; ++i) {
    var overrides = arguments[i]
    if (typeof overrides === 'object') {
      var keys = Object.keys(overrides)
      for (var j = 0, keyLen = keys.length; j < keyLen; ++j) {
        var k = keys[j]
        if (overrides[k] !== undefined) {
          target[k] = overrides[k]
        }
      }
    }
  }
  return target
}

async function createSocksSocket (opts, mqttClient) {
  return new Promise(async (resolve, reject) => {
    try {
      let socksOptions = {...opts}
      let proxyInfo = socksOptions.proxy
      let destinationInfo = {
        host: socksOptions.host,
        port: socksOptions.port
      }
      let proxyPort = proxyInfo.port
      if (typeof (proxyPort) !== 'number') {
        proxyPort = parseInt(proxyPort)
      }
      proxyInfo.port = proxyPort
      let socksOpts = {
        proxy: proxyInfo,
        command: 'connect',
        destination: destinationInfo
      }
      const { socket } = await SocksClient.createConnection(socksOpts)
      resolve(socket)
    } catch (err) {
      console.log(err)
      reject(err)
    }
  })
}

async function createSocket (opts, mqttClient) {
  return new Promise((resolve, reject) => {
    try {
      let options = {...opts}
      options.protocol = 'http'
      console.log(options)
      let connectOptions = mergeOptions({}, options.proxy, {
        method: 'CONNECT',
        path: options.host + ':' + options.port,
        agent: false,
        headers: {
          host: options.host + ':' + options.port
        }
      })
      if (options.localAddress) {
        connectOptions.localAddress = options.localAddress
      }
      if (connectOptions.proxyAuth) {
        connectOptions.headers = connectOptions.headers || {}
        connectOptions.headers['Proxy-Authorization'] = 'Basic ' +
            Buffer.from(connectOptions.proxyAuth).toString('base64')
      }
      console.log(connectOptions)
      let connectReq = http.request(connectOptions)
      connectReq.useChunkedEncodingByDefault = false
      let onResponse = function (res) {
        // Very hacky. This is necessary to avoid http-parser leaks.
        res.upgrade = true
      }
      let onUpgrade = function (res, socket, head) {
        // Hacky.
        process.nextTick(function () {
          onConnect(res, socket, head)
        })
      }
      let onError = function (cause) {
        connectReq.removeAllListeners()
        console.log('tunneling socket could not be established' + cause)
        reject(cause)
      }

      let onConnect = function (res, socket, head) {
        connectReq.removeAllListeners()
        socket.removeAllListeners()

        if (res.statusCode !== 200) {
          console.log('tunneling socket could not be established, statusCode=%d', res.statusCode)
          socket.destroy()
          let error = 'tunneling socket could not be established, ' + 'statusCode=' + res.statusCode
          mqttClient.emit('error', error)
          return
        }
        if (head.length > 0) {
          console.log('got illegal response body from proxy')
          socket.destroy()
          mqttClient.emit('error', 'got illegal response body from proxy')
          return
        }
        console.log('tunneling connection has established')
        resolve(socket)
      }

      connectReq.once('response', onResponse)
      connectReq.once('upgrade', onUpgrade)
      connectReq.once('connect', onConnect)
      connectReq.once('error', onError)
      connectReq.end()
    } catch (err) {
      console.log(err)
      reject(err)
    }
  })
}

module.exports = buildBuilder
