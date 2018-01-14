const ashify = require('ashify')
const fs = require('fs')
const net = require('net')
const path = require('path')

const MovableStream = require('./index')

let server1, server2, client1, client2

let toCreate = 4

let s1 = net.createServer(function (serverConn) {
	server1 = serverConn
	if (--toCreate === 0)
		runTest()
})
let s2 = net.createServer(function (serverConn) {
	server2 = serverConn
	if (--toCreate === 0)
		runTest()
})

client1 = net.createConnection(9998, function () {
	if (--toCreate === 0)
		runTest()
})
client2 = net.createConnection(9999, function () {
	if (--toCreate === 0)
		runTest()
})

s1.listen(9998)
s2.listen(9999)

let hashesExpected = 3
let computedHash = null
const verify = function (hash) {
	if (!computedHash) {
		computedHash = hash
	}

	if (computedHash !== hash) {
		console.error('hashes different!')
		process.exit(1)
	}

	if (--hashesExpected === 0) {
		console.log('success!')
		process.exit(0)
	}
}

const runTest = function () {
	const serverClientData = fs.createReadStream(path.join(__dirname, 'test-data'))
	const clientServerData = fs.createReadStream(path.join(__dirname, 'test-data'))
	const refData = fs.createReadStream(path.join(__dirname, 'test-data'))

	const serverEnd = new MovableStream(server1)
	const clientEnd = new MovableStream(client1)

	serverClientData.pipe(serverEnd)
	clientServerData.pipe(clientEnd)
	const ashifyOpts = {
		algorithm: 'sha256',
		encoding: 'hex'
	}
	ashify(refData, ashifyOpts, function (err, data) {
		if (err)
			console.error(err)
		else {
			console.log('direct hash:', data)
			verify(data)
		}
	})

	ashify(clientEnd, ashifyOpts, function (err, data) {
		if (err)
			console.error(err)
		else {
			console.log('client end received:', data)
			verify(data)
		}
	})

	ashify(serverEnd, ashifyOpts, function (err, data) {
		if (err)
			console.error(err)
		else {
			console.log('server end received:', data)
			verify(data)
		}
	})

	serverEnd.on('moved', function () {
		console.log('server end moved')
		server1.destroy()
	})
	clientEnd.on('moved', function () {
		console.log('client end moved')
		client1.destroy()
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

