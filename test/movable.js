const test = require('tape')
const ashify = require('ashify')
const file = require('pull-file')
const createServer = require('pull-net/server')
const connect  = require('pull-net/client')
const path = require('path')
const pull = require('pull-stream')
const toStream = require('pull-stream-to-stream')
const DuplexPair = require('pull-pair/duplex')

const MovableStream = require('../index')

test.skip('switch midstream with loopback', function (t) {
	const ashifyOpts = {
		algorithm: 'sha256',
		encoding: 'hex'
	}
	const refData = file(path.join(__dirname, 'test-data'))
	ashify(toStream.source(refData), ashifyOpts, function (err, data) {
		if (err)
			return t.fail(err)
		const refHash = data

		let loopback1 = DuplexPair()
		let loopback2 = DuplexPair()

		const end1 = new MovableStream(loopback1[0])
		const end2 = new MovableStream(loopback1[1])

		pull(file(path.join(__dirname, 'test-data')), end1)
		pull(file(path.join(__dirname, 'test-data')), end2)

		let hashesExpected = 2
		;
		[end1, end2].forEach(function (streamEnd) {
			ashify(toStream.source(streamEnd.source), ashifyOpts, function (err, data) {
				console.log('end cb')
				if (err)
					return t.fail(err)
				t.equals(data, refHash, 'hash correct')

				if (--hashesExpected === 0)
					t.end()
			})
			streamEnd.on('moved', function () {
				console.log('end moved')
			})
		})

		setTimeout(function () {
			console.log('moving end1')
			end1.moveto(loopback2[0])
			setTimeout(function () {
				console.log('moving end2')
				end2.moveto(loopback2[1])
			}, 100)
		}, 100)
	})
})

test.skip('switch midstream with tcp', function (t) {
	let server1, server2, client1, client2

	let toCreate = 5

	let s1 = createServer(function (serverConn) {
		server1 = serverConn
		if (--toCreate === 0)
			runTest()
	})
	s1.listen(9998, '127.0.0.1')

	let s2 = createServer(function (serverConn) {
		server2 = serverConn
		if (--toCreate === 0)
			runTest()
	})
	s2.listen(9999, '127.0.0.1')

	client1 = connect(9998, '127.0.0.1', function () {
		if (--toCreate === 0)
			runTest()
	})
	client2 = connect(9999, '127.0.0.1', function () {
		if (--toCreate === 0)
			runTest()
	})

	const ashifyOpts = {
		algorithm: 'sha256',
		encoding: 'hex'
	}
	const refData = file(path.join(__dirname, 'test-data'))
	let refHash = null
	ashify(toStream.source(refData), ashifyOpts, function (err, data) {
		if (err)
			return t.fail(err)
		
		refHash = data
		if (--toCreate === 0)
			runTest()
	})

	const runTest = function () {
		const serverEnd = new MovableStream(server1)
		const clientEnd = new MovableStream(client1)

		pull(file(path.join(__dirname, 'test-data')), serverEnd)
		pull(file(path.join(__dirname, 'test-data')), clientEnd)

		let hashesExpected = 2
		;
		[clientEnd, serverEnd].forEach(function (streamEnd) {		
			ashify(toStream.source(streamEnd.source), ashifyOpts, function (err, data) {
				if (err)
					return t.fail(err)

				t.equals(data, refHash, 'hash correct')

				if (--hashesExpected === 0) {
					s1.close()
					s2.close()

					serverEnd.abort() // TODO: shouldn't be necessary
					clientEnd.abort()
					t.end()
				}
			})

			streamEnd.on('moved', function () {
				console.log('end moved')
			})
		})

		setTimeout(function () {
			console.log('moving client end')
			clientEnd.moveto(client2)
			setTimeout(function () {
				console.log('moving server end')
				serverEnd.moveto(server2)
			}, 100)
		}, 100)
	}
})

const muxrpc = require('muxrpc')

test.skip('switch with muxrpc', function (t) {
	let server1, server2, client1, client2

	let toCreate = 4

	let s1 = createServer(function (serverConn) {
		server1 = serverConn
		if (--toCreate === 0)
			runTest()
	})
	s1.listen(9998, '127.0.0.1')

	let s2 = createServer(function (serverConn) {
		server2 = serverConn
		if (--toCreate === 0)
			runTest()
	})
	s2.listen(9999, '127.0.0.1')

	client1 = connect(9998, '127.0.0.1', function () {
		if (--toCreate === 0)
			runTest()
	})
	client2 = connect(9999, '127.0.0.1', function () {
		if (--toCreate === 0)
			runTest()
	})


	const runTest = function () {
		const serverEnd = new MovableStream(server1)
		const clientEnd = new MovableStream(client1)

		const api = {
			hello: 'async',
			foobar: 'async'
		}

		let client = muxrpc(api, null)()
		let server = muxrpc(null, api)({
			hello: function (name, cb) {
				cb(null, 'hello, ' + name + '!')
			},
			foobar: function (arg, cb) {
				process.nextTick(function () {
					cb(null, arg + 1)
				})
			}
		})

		let a = client.createStream()
		pull(a, clientEnd, a)
		let b = server.createStream()
		pull(b, serverEnd, b)

		client.hello('world', function (err, value) {
			if (err)
				return t.fail('error')
			t.equals(value, 'hello, world!', 'value correct before move')

			serverEnd.moveto(server2)
			clientEnd.moveto(client2)
			clientEnd.on('moved', function () {
				client.foobar(41, function (err, value) {
					if (err)
						return t.fail('error')
					t.equals(value, 42, 'value correct after move')
					clientEnd.abort()
					serverEnd.abort()
					s1.close()
					s2.close()
					t.end()
				})
			})
		})
	}
})

const wsClient = require('pull-ws/client')
const wsServer = require('pull-ws/server')
const SimplePeer = require('simple-peer')
const wrtc = require('wrtc')
const toPull = require('stream-to-pull-stream')

test.skip('switch with muxrpc from websocket to webrtc', function (t) {
	let server1, client1

	let toCreate = 4

	let s1 = wsServer(function (serverConn) {
		server1 = serverConn
		if (--toCreate === 0)
			runTest()
	}).listen(9998)

	client1 = wsClient('ws://localhost:9998', function () {
		if (--toCreate === 0)
			runTest()
	})

	let serverPeer = new SimplePeer({
		initiator: false,
		wrtc: wrtc
	})
	serverPeer.on('signal', function (data) {
		clientPeer.signal(data)
	})
	serverPeer.on('connect', function () {
		if (--toCreate === 0)
			runTest()
	})
	let server2 = toPull.duplex(serverPeer)

	let clientPeer = new SimplePeer({
		initiator: true,
		wrtc: wrtc
	})
	clientPeer.on('signal', function (data) {
		serverPeer.signal(data)
	})
	clientPeer.on('connect', function () {
		if (--toCreate === 0)
			runTest()
	})
	let client2 = toPull.duplex(clientPeer)

	const runTest = function () {
		const serverEnd = new MovableStream(server1)
		const clientEnd = new MovableStream(client1)

		const api = {
			hello: 'async',
			foobar: 'async'
		}

		let client = muxrpc(api, null)()
		let server = muxrpc(null, api)({
			hello: function (name, cb) {
				cb(null, 'hello, ' + name + '!')
			},
			foobar: function (arg, cb) {
				process.nextTick(function () {
					cb(null, arg + 1)
				})
			}
		})

		let a = client.createStream()
		pull(a, clientEnd, a)
		let b = server.createStream()
		pull(b, serverEnd, b)

		client.hello('world', function (err, value) {
			if (err)
				return t.fail('error')
			t.equals(value, 'hello, world!', 'value correct before move')

			serverEnd.moveto(server2)
			clientEnd.moveto(client2)
			clientEnd.on('moved', function () {
				client.foobar(41, function (err, value) {
					if (err)
						return t.fail('error')
					t.equals(value, 42, 'value correct after move')
					clientEnd.abort()
					serverEnd.abort()
					s1.close()
					t.end()
				})
			})
		})
	}
})

test('switch with muxrpc from muxrpc over websocket (nested) to webrtc', function (t) {
	let server1, client1, rawServerConn, rawClientConn, rawServerHandle, rawClientHandle

	// let toCreate = 4

	const outerApi = {
		sss: 'duplex'
	}

	let barbaz = DuplexPair()
	rawServerConn = barbaz[0]
	rawClientConn = barbaz[1]

	// let s1 = wsServer(function (serverConn) {
	// 	rawServerConn = serverConn
		rawServerHandle = muxrpc(null, outerApi)({
			sss: function () {
				console.log('got sss')
				let loopback = DuplexPair()
				server1 = loopback[0]
				// console.log('here', toCreate)
				// if (--toCreate === 0)
				process.nextTick(runTest)
					// runTest()
				return loopback[1]
			}
		})

		let a = rawServerHandle.createStream()
		pull(a, rawServerConn, a)

	// }).listen(9998)

	// rawClientConn = wsClient('ws://localhost:9998', function () {
		rawClientHandle = muxrpc(outerApi, null)()
		let b = rawClientHandle.createStream()
		pull(b, rawClientConn, b)
		console.log('calling sss')
		client1 = rawClientHandle.sss()
		// if (--toCreate === 0)
		// 	runTest()
	// })

	let foobar = DuplexPair()
	let server2 = foobar[0]
	let client2 = foobar[1]
	// toCreate -= 2

	// let serverPeer = new SimplePeer({
	// 	initiator: false,
	// 	wrtc: wrtc
	// })
	// serverPeer.on('signal', function (data) {
	// 	clientPeer.signal(data)
	// })
	// serverPeer.on('connect', function () {
	// 	if (--toCreate === 0)
	// 		runTest()
	// })
	// let server2 = toPull.duplex(serverPeer)

	// let clientPeer = new SimplePeer({
	// 	initiator: true,
	// 	wrtc: wrtc
	// })
	// clientPeer.on('signal', function (data) {
	// 	serverPeer.signal(data)
	// })
	// clientPeer.on('connect', function () {
	// 	if (--toCreate === 0)
	// 		runTest()
	// })
	// let client2 = toPull.duplex(clientPeer)

	function runTest () {
		const serverEnd = new MovableStream(server1, 'server')
		const clientEnd = new MovableStream(client1, 'client')

		const api = {
			hello: 'async',
			foobar: 'async'
		}

		let client = muxrpc(api, null)()
		let server = muxrpc(null, api)({
			hello: function (name, cb) {
				cb(null, 'hello, ' + name + '!')
			},
			foobar: function (arg, cb) {
				process.nextTick(function () {
					cb(null, arg + 1)
				})
			}
		})

		let a = client.createStream()
		pull(a, clientEnd, a)
		let b = server.createStream()
		pull(b, serverEnd, b)

		client.hello('world', function (err, value) {
			if (err)
				return t.fail('error')
			t.equals(value, 'hello, world!', 'value correct before move')

			function endOfTest() {
				console.log('moved EMITTED')
				client.foobar(41, function (err, value) {
					if (err) {
						console.log(err)
						return t.fail('error')
					}
					t.equals(value, 42, 'value correct after move')
					clientEnd.abort()
					serverEnd.abort()
					// s1.close()
					t.end()
				})
			}

			serverEnd.moveto(server2)
			clientEnd.moveto(client2)
			// clientEnd.on('moved', endOfTest)
			clientEnd.on('moved', function () { process.nextTick(endOfTest) })

			// process.nextTick(endOfTest)
		})
	}
})
