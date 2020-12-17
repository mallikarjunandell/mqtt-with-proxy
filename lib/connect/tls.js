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
    console.log('[MQTT] Entered into TLS connection proxy streambuilder');
    console.log(opts);
    let proxy = opts.proxy;
    opts.agent = getCaAgent(opts, proxy);

    try
    {
      let req = https.request({
        rejectUnauthorized: opts.rejectUnauthorized,
        ca: opts.ca,
        host: proxy.host,
        port: proxy.port,
        method: 'CONNECT',
        path: `${opts.host}:${opts.port}`
      });
      
      req.on('connect', (res, socket) => {
        
        connection = tls.connect({
          host: opts.host,
          port: opts.port,
          rejectUnauthorized: opts.rejectUnauthorized,
          ca: opts.ca,
          socket: socket
        });

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
    
        connection.on('error', handleTLSerrors);
        
        return connection;
      });
    }
    catch(err)
    {
      console.log(err);
    }
  }
  else
  {
    console.log('[MQTT] No proxy details found for MQTT. Creating direct connection');
    connection = tls.connect(opts);

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

    connection.on('error', handleTLSerrors);
    return connection;
  }
}


function getCaAgent(options, proxyInfo)
{
  let caAgent = https.Agent;
  console.log('[MQTT] Getting CA agent for stream builder');
  try
  {
    console.log('[MQTT] Proxy type :' + proxyInfo.type);
    switch(proxyInfo.type)
    {
      case 'http':
      case 'https':
        caAgent = tunnel.httpsOverHttp({
          ca: options.ca,
          rejectUnauthorized: options.rejectUnauthorized,
          proxy: { 
            host: proxyInfo.host,
            port: proxyInfo.port
          }
        });
        console.log('[MQTT] Created HTTP/HTTPS CA agent for stream builder');
        break;
      case 'socks':
        caAgent = new SocksProxyAgent({
          ca: options.ca,
          rejectUnauthorized: options.rejectUnauthorized,
          host: proxyInfo.host,
          port: proxyInfo.port
        });
        console.log('[MQTT] Created SOCKS CA agent for stream builder');
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
