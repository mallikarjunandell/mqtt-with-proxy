'use strict'
var tls = require('tls')
var debug = require('debug')('mqttjs:tls');
const SocksProxyAgent = require('https-socks-proxy');
const tunnel = require('tunnel');
const https = require('https');
const http = require('http');
const SocksClient = require('socks').SocksClient;

async function buildBuilder (mqttClient, opts) {
  
  return new Promise(async (resolve, reject) => {
    opts.port = opts.port || 8443
    opts.host = opts.hostname || opts.host || 'localhost'
    opts.servername = opts.host

    opts.rejectUnauthorized = opts.rejectUnauthorized | false;

    delete opts.path

    debug('port %d host %s rejectUnauthorized %b', opts.port, opts.host, opts.rejectUnauthorized)

    if(opts.proxy)
    {
      debug('[MQTT] Entered into TLS connection proxy streambuilder');
      //debug(opts);
      let proxy = opts.proxy;
      
      try
      {
        let proxySocket = "";
        if(proxy.proxyType == 'https' || proxy.proxyType == 'http')
        {
          proxySocket = await createSocket(opts, mqttClient);
          debug('Creating HTTP/HTTPS proxy socket for MQTT');
        }
        else if(proxy.proxyType == 'socks')
        {
          proxySocket = await createSocksSocket(opts ,mqttClient);
          debug('Creating SOCKS proxy socket for MQTT');
        }
        else
        {
          proxySocket = await createSocket(opts, mqttClient);
        }
        let options = opts;
        let tlsOptions = mergeOptions({}, proxy,{
          socket: proxySocket,
          servername: options.host
        });
        tlsOptions.rejectUnauthorized = false;
        debug('Received proper proxy socket. Printing TLS options');
        debug(tlsOptions);
        let secureSocket = tls.connect(tlsOptions);

        debug('Secure socket after tls connect :');
        debug(secureSocket);
        debug('Starting the listeners for the MQTT proxy socket');
        
        secureSocket.on('secureConnect',  () => {
          if (opts.rejectUnauthorized==true && secureSocket.authorized == false) {
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
        debug(err);
        reject(err);
      }
    }
    else
    {
      debug('[MQTT] No proxy details found for MQTT. Creating direct connection');
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
  debug('[MQTT] Getting CA agent for stream builder');
  try
  {
    debug('[MQTT] Proxy type :' + proxyInfo.type);
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
        debug('[MQTT] Created HTTP/HTTPS CA agent for stream builder');
        break;
      case 'socks':
        caAgent = new SocksProxyAgent({
          ca: options.ca,
          rejectUnauthorized: options.rejectUnauthorized,
          host: proxyInfo.host,
          port: proxyInfo.port
        });
        debug('[MQTT] Created SOCKS CA agent for stream builder');
        break;
      default:
        break;
    }
  }
  catch(err)
  {
    debug(err);
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

async function createSocksSocket(opts, mqttClient)
{
  return new Promise( async (resolve, reject) => {
    try
    {
      let socksOptions = {...opts};
      let proxyInfo = socksOptions.proxy;
      let destinationInfo = {
        host: socksOptions.host,
        port: socksOptions.port
      };

      let proxyPort = proxyInfo.port;
      if(typeof(proxyPort) != 'number')
      {
        proxyPort = parseInt(proxyPort);
      }
      proxyInfo.port = proxyPort;

      let socksOpts = {
        proxy: proxyInfo,
        command: 'connect',
        destination: destinationInfo
      };
      const { socket } = await SocksClient.createConnection(socksOpts);
      resolve(socket);
    }
    catch(err)
    {
      debug(err);
      reject(err);
    }
  });
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
      debug(connectOptions);
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
        debug('tunneling socket could not be established' + cause);
        reject(cause);
      }

      function onConnect(res, socket, head) {
        connectReq.removeAllListeners();
        socket.removeAllListeners();

        if (res.statusCode !== 200) {
          debug('tunneling socket could not be established, statusCode=%d', res.statusCode);
          socket.destroy();
          let error = 'tunneling socket could not be established, ' +'statusCode=' + res.statusCode;
          mqttClient.emit('error', error);
          return;
        }
        if (head.length > 0) {
          debug('got illegal response body from proxy');
          socket.destroy();
          mqttClient.emit('error', 'got illegal response body from proxy');
          return;
        }
        debug('tunneling connection has established');
        resolve(socket);
      }
    }
    catch(err)
    {
      debug(err);
      reject(err);
    }
  });
}

module.exports = buildBuilder
