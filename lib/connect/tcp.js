'use strict'
var net = require('net')
var debug = require('debug')('mqttjs:tcp')
//  const socksClient = require('socks').SocksClient

/*
  variables port and host can be removed since
  you have all required information in opts object
*/
function streamBuilder (client, opts) {
  var port, host
  opts.port = opts.port || 1883
  opts.hostname = opts.hostname || opts.host || 'localhost'
  port = opts.port
  host = opts.hostname
  debug('port %d and host %s', port, host)
  try {
    debug('[MQTT] Entered into tcp connection streambuilder')
    return net.createConnection(port, host)
  } catch (err) {
    debug(err)
  }
  return net.createConnection(port, host)
}

//  function createTcpStreamViaSocksProxy(options, proxy)
// {
//   let proxySocket = null;
//   try {
//     let socksOptions = {
//       proxy: proxy,
//       command: 'connect',
//       destination: {
//         host: options.host,
//         port: options.port
//       }
//     }
//     socksClient.createConnection(socksOptions, (res)=> {
//       proxySocket = res.socket
//     }).catch(err => {
//       debug(err)
//     })
//   } catch (err) {
//     debug(err)
//   }
//   return proxySocket
// }

module.exports = streamBuilder
