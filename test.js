const test = require('tape')
const ashify = require('ashify')
const file = require('pull-file')
const createServer = require('pull-net/server')
const connect  = require('pull-net/client')
const path = require('path')
const pull = require('pull-stream')
const toStream = require('pull-stream-to-stream')

const MovableStream = require('./index')

test('switch midstream', function (t) {
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


	let hashesExpected = 3
	let computedHash = null
	const verify = function (hash) {
		if (computedHash) {
			t.equals(computedHash, hash, 'hash correct')
		} else {
			computedHash = hash
		}

		if (--hashesExpected === 0) {
			s1.close()
			s2.close()
			t.end()
		}
	}

	const runTest = function () {
		const serverClientData = file(path.join(__dirname, 'test-data'))
		const clientServerData = file(path.join(__dirname, 'test-data'))
		const refData = file(path.join(__dirname, 'test-data'))

		const serverEnd = new MovableStream(server1)
		const clientEnd = new MovableStream(client1)

		pull(serverClientData, serverEnd)
		pull(clientServerData, clientEnd)

		const ashifyOpts = {
			algorithm: 'sha256',
			encoding: 'hex'
		}
		ashify(toStream.source(refData), ashifyOpts, function (err, data) {
			if (err)
				console.error(err)
			else {
				console.log('direct hash:', data)
				verify(data)
			}
		})

		ashify(toStream.source(clientEnd.source), ashifyOpts, function (err, data) {
			if (err)
				console.error(err)
			else {
				console.log('client end received:', data)
				verify(data)
			}
		})

		ashify(toStream.source(serverEnd.source), ashifyOpts, function (err, data) {
			if (err)
				console.error(err)
			else {
				console.log('server end received:', data)
				verify(data)
			}
		})

		serverEnd.on('moved', function () {
			console.log('server end moved')
		})
		clientEnd.on('moved', function () {
			console.log('client end moved')
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

