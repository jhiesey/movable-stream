# movable-stream

## What?

This module is a duplex stream, like a regular socket, which wraps some, other *underlying* duplex stream. You use one instance at each end of the stream, and it allows you to *replace* the underlying stream, while data is flowing, without the code using the movable stream noticing that anything changed.

It switches streams,... midstream.

## Why?

Say you want to send data between two browsers using WebRTC data channels. You already need to connect to a signaling server (using e.g. websockets) to open a WebRTC connection in the first place, and it takes a little while for the WebRTC connection to open.

Instead of waiting for the connection to open before sending data, you can set up a stream multiplexed on top of the websockets you already have that forwards data from browser <-> server <-> browser. You are using the server, temporarily, as a relay. Once the WebRTC connection is open, you can transparently replace the relayed connection with the brand-new WebRTC connection, all without the code using the stream noticing anything changed at all!

## Example

```
let Movable = require('movable-stream')

let originalStream = ... // whatever stream you want wrap initially (e.g. over websockets)

let ms = new Movable(originalStream)

// now ms is readable and writable
ms.on('data', (chunk) => {
  console.log('Received ${chunk.length} bytes of data.');
});

ms.write('hello, world!')

let newStream = ... // a replacement for originalStream (e.g. WebRTC data channel stream)

ms.on('switched', () => {
	originalStream.destroy() // original stream is no longer needed
})
ms.replace(newStream) // data starts flowing over newStream instead of originalStream, transparently

```

## License

MIT