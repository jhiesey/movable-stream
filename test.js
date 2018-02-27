const test = require('tape')
const ashify = require('ashify')
const file = require('pull-file')
const createServer = require('pull-net/server')
const connect  = require('pull-net/client')
const path = require('path')
const pull = require('pull-stream')
const toStream = require('pull-stream-to-stream')
const DuplexPair = require('pull-pair/duplex')

const MovableStream = require('./index')

test('switch midstream with loopback', function (t) {
	const ashifyOpts = {
		algorithm: 'sha256',
		encoding: 'hex'
	}
	const refData = file(path.join(__dirname, 'test-data'))
	ashify(toStream.source(refData), ashifyOpts, function (err, data) {
		if (err)
			return t.fail(err)
		const refHash = data

		let hashesExpected = 2
		const verify = function (hash) {
			t.equals(hash, refHash, 'hash correct')

			if (--hashesExpected === 0) {
				t.end()
			}
		}

		let loopback1 = DuplexPair()
		let loopback2 = DuplexPair()

		const end1 = new MovableStream(loopback1[0])
		const end2 = new MovableStream(loopback1[1])

		pull(file(path.join(__dirname, 'test-data')), end1)
		pull(file(path.join(__dirname, 'test-data')), end2)

		;
		[end1, end2].forEach(function (streamEnd) {
			ashify(toStream.source(streamEnd.source), ashifyOpts, function (err, data) {
				console.log('cb')
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

