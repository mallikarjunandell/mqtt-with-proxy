'use strict'
var net = require('net');
var debug = require('debug')('mqttjs:tcp');
const socksClient = require('socks').SocksClient;

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

  try
  {
    console.log('[MQTT] Entered into tcp connection streambuilder');
    if(opts.proxy)
    {
      console.log('[MQTT] Entered into tcp connection streambuilder');
      let proxy = {
        host: "",
        port: 1080
      };
      proxy.host = opts.proxy.host;
      if(opts.proxy.port)
      {
        proxy.port = opts.proxy.port;
      }
      console.log('[MQTT] Inside found proxy details for MQTT');
      console.log(opts);
      let connection = net.createConnection({
        host: proxy.host,
        port: proxy.port,
        method: 'CONNECT',
        path: `${opts.host}:${opts.port}`
      });
      return connection;
    }
    else
    {
      return net.createConnection(port, host);
    }
  }
  catch(err)
  {
    debug(err);
    //console.log('[MQTT] :' + err);
  }
  return net.createConnection(port, host)
}

async function createTcpStreamViaSocksProxy(options, proxy)
{
  let socksOptions = {
    proxy: proxy,
    command: 'connect',
    destination: {
      host: options.host,
      port: options.port
    }
  }
  let socksResult = await socksClient.createConnection(socksOptions);
  return socksResult.socket;
}

module.exports = streamBuilder
