'use strict'
var tls = require('tls')
var debug = require('debug')('mqttjs:tls');
const SocksProxyAgent = require('https-socks-proxy');
const tunnel = require('tunnel');
const https = require('https');

function buildBuilder (mqttClient, opts) {
  var connection
  opts.port = opts.port || 8883
  opts.host = opts.hostname || opts.host || 'localhost'
  opts.servername = opts.host

  opts.rejectUnauthorized = opts.rejectUnauthorized !== false

  delete opts.path

  debug('port %d host %s rejectUnauthorized %b', opts.port, opts.host, opts.rejectUnauthorized)

  if(opts.proxy)
  {
    console.log('[MQTT] Entered into TLS connection streambuilder');
    let proxy = {
      host: "",
      port: 808
    };
    proxy.host = opts.proxy.host;
    if(opts.proxy.port)
    {
      proxy.port = opts.proxy.port;
    }
    opts.agent = getCaAgent(opts, proxy);
  }

  connection = tls.connect(opts)
  /* eslint no-use-before-define: [2, "nofunc"] */
  connection.on('secureConnect', function () {
    if (opts.rejectUnauthorized && !connection.authorized) {
      connection.emit('error', new Error('TLS not authorized'))
    } else {
      connection.removeListener('error', handleTLSerrors)
    }
  })

  function handleTLSerrors (err) {
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
  return connection
}

function getCaAgent(options, proxy)
{
  let caAgent = https.Agent;
  try
  {
    switch(proxy.type)
    {
      case 'http':
      case 'https':
        caAgent = tunnel.httpsOverHttp({
          ca: options.ca,
          rejectUnauthorized: options.rejectUnauthorized,
          proxy: { 
            host: proxy.host,
            port: proxy.port
          }
        });
        break;
      case 'socks':
        caAgent = new SocksProxyAgent({
          ca: options.ca,
          rejectUnauthorized: options.rejectUnauthorized,
          host: proxy.host,
          port: proxy.port
        })
        break;
      default:
        break;
    }
  }
  catch(err)
  {
    console.log(err);
  }
  return caAgent;
}

module.exports = buildBuilder
