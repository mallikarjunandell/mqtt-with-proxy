'use strict'
var tls = require('tls')
var debug = require('debug')('mqttjs:tls');
const SocksProxyAgent = require('https-socks-proxy');
const tunnel = require('tunnel');
const https = require('https');
const http = require('http');

async function buildBuilder (mqttClient, opts) {
  
  return new Promise(async (resolve, reject) => {
    opts.port = opts.port || 8883
    opts.host = opts.hostname || opts.host || 'localhost'
    opts.servername = opts.host

    opts.rejectUnauthorized = opts.rejectUnauthorized !== false

    delete opts.path

    debug('port %d host %s rejectUnauthorized %b', opts.port, opts.host, opts.rejectUnauthorized)

    if(opts.proxy)
    {
      console.log('[MQTT] Entered into TLS connection proxy streambuilder');
      //console.log(opts);
      let proxy = opts.proxy;
      
      try
      {
        let proxySocket = await createSocket(opts, mqttClient);
        let options = opts;
        let tlsOptions = mergeOptions({}, proxy, {
          socket: proxySocket,
          servername: options.host
        });
        let secureSocket = tls.connect(0, tlsOptions);

        secureSocket.on('secureConnect',  () => {
          if (opts.rejectUnauthorized && !secureSocket.authorized) {
            secureSocket.emit('error', 'NOT_AUTHORIZED');
          } else {
            secureSocket.removeListener('error', handleTLSerrors1)
          }
        });

        function handleTLSerrors1 (err) {
          // How can I get verify this error is a tls error?
          if (opts.rejectUnauthorized) {
            mqttClient.emit('error', err)
          }
          secureSocket.end()
        }
  
        secureSocket.on('error', handleTLSerrors1);
        resolve(secureSocket);
        
      }
      catch(err)
      {
        console.log(err);
        reject(err);
      }
    }
    else
    {
      console.log('[MQTT] No proxy details found for MQTT. Creating direct connection');
      let connection = tls.connect(opts);

      /* eslint no-use-before-define: [2, "nofunc"] */
      connection.on('secureConnect', function () {
        if (opts.rejectUnauthorized && !connection.authorized) {
          connection.emit('error', 'NOT_AUTHORIZED');
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
      resolve(connection);
    }
  });
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

function mergeOptions(target) {
  for (var i = 1, len = arguments.length; i < len; ++i) {
    var overrides = arguments[i];
    if (typeof overrides === 'object') {
      var keys = Object.keys(overrides);
      for (var j = 0, keyLen = keys.length; j < keyLen; ++j) {
        var k = keys[j];
        if (overrides[k] !== undefined) {
          target[k] = overrides[k];
        }
      }
    }
  }
  return target;
}


async function createSocket(opts, mqttClient)
{
  return new Promise( (resolve, reject) => {
    try
    {
      let options = {...opts};
      let connectOptions = mergeOptions({}, options.proxy, {
        method: 'CONNECT',
        path: options.host + ':' + options.port,
        agent: false,
        headers: {
          host: options.host + ':' + options.port
        }
      });
      if (options.localAddress) {
        connectOptions.localAddress = options.localAddress;
      }
      if (connectOptions.proxyAuth) {
        connectOptions.headers = connectOptions.headers || {};
        connectOptions.headers['Proxy-Authorization'] = 'Basic ' +
            Buffer.from(connectOptions.proxyAuth).toString('base64');
      }
      console.log(connectOptions);
      let connectReq = http.request(connectOptions);
      connectReq.useChunkedEncodingByDefault = false; // for v0.6
      connectReq.once('response', onResponse); // for v0.6
      connectReq.once('upgrade', onUpgrade);   // for v0.6
      connectReq.once('connect', onConnect);   // for v0.7 or later
      connectReq.once('error', onError);
      connectReq.end();

      function onResponse(res) {
        // Very hacky. This is necessary to avoid http-parser leaks.
        res.upgrade = true;
      }

      function onUpgrade(res, socket, head) {
        // Hacky.
        process.nextTick(function() {
          onConnect(res, socket, head);
        });
      }

      function onError(cause) {
        connectReq.removeAllListeners();
        console.log('tunneling socket could not be established' + cause);
        reject(cause);
      }

      function onConnect(res, socket, head) {
        connectReq.removeAllListeners();
        socket.removeAllListeners();

        if (res.statusCode !== 200) {
          console.log('tunneling socket could not be established, statusCode=%d', res.statusCode);
          socket.destroy();
          let error = 'tunneling socket could not be established, ' +'statusCode=' + res.statusCode;
          mqttClient.emit('error', error);
          return;
        }
        if (head.length > 0) {
          console.log('got illegal response body from proxy');
          socket.destroy();
          mqttClient.emit('error', 'got illegal response body from proxy');
          return;
        }
        console.log('tunneling connection has established');
        resolve(socket);
      }
    }
    catch(err)
    {
      console.log(err);
      reject(err);
    }
  });
}

module.exports = buildBuilder
