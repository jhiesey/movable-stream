const test = require('tape')
const pull = require('pull-stream')
const pair = require('pull-pair')
const collect = require('pull-stream/sinks/collect')

const injector = require('../lib/injector')

const noop = function () {}

test('simple', function (t) {
	let dest = pair()

	let inj = injector(dest.sink)
	let state = 0
	inj(function (end, cb) {
		if (end)
			return cb(end, noop)

		switch (state++) {
			case 0:
				cb(null, Buffer.from([100]))
				break
			case 1:
				inj.inject(Buffer.from([101]))
				cb(null, Buffer.from([102]))
				break
			case 2:
				cb(true)
				inj.inject(Buffer.from([103]))
				process.nextTick(function () {
					inj.abort()
				})
				break
			default:
				t.fail('unexpected read call')
				break
		}
	})

	pull(dest, collect(function (err, data) {
		if (err)
			return t.fail('error')
		let all = Buffer.concat(data)
		t.ok(all.equals(Buffer.from([0,0,0,0,1,100,1,0,0,0,1,101,0,0,0,0,1,102,2,1,0,0,0,1,103])), 'correct data')
		t.end()
	}))
})

test('switching', function (t) {
	let dest1 = pair()
	let dest2 = pair()

	let inj = injector(dest1.sink)
	let state = 0
	inj(function (end, cb) {
		if (end)
			return cb(end, noop)

		switch (state++) {
			case 0:
				cb(null, Buffer.from([100]))
				break
			case 1:
				inj.injectAndSwitch(Buffer.from([101]), dest2.sink)
				cb(null, Buffer.from([102]))
				break
			case 2:
				cb(true)
				inj.inject(Buffer.from([103]))
				process.nextTick(function () {
					inj.abort()
				})
				break
			default:
				t.fail('unexpected read call')
				break
		}
	})

	pull(dest1, collect(function (err, data) {
		if (err)
			return t.fail('error')
		let all = Buffer.concat(data)
		t.ok(all.equals(Buffer.from([0,0,0,0,1,100,1,0,0,0,1,101])), 'correct data 1')
	}))
	pull(dest2, collect(function (err, data) {
		if (err)
			return t.fail('error')
		let all = Buffer.concat(data)
		t.ok(all.equals(Buffer.from([0,0,0,0,1,102,2,1,0,0,0,1,103])), 'correct data 2')
		t.end()
	}))
})

test('abort', function (t) {
	let dest = pair()

	let inj = injector(dest.sink)
	let state = 0
	inj(function (end, cb) {
		if (end)
			return cb(end, noop)

		switch (state++) {
			case 0:
				cb(null, Buffer.from([100]))
				inj.abort()
				inj.abort()
				break
			default:
				t.fail('unexpected read call')
				break
		}
	})

	pull(dest, collect(function (err, data) {
		if (err)
			return t.fail('error')
		t.pass('ended')
		t.end()
	}))
})

test('source errors', function (t) {
	let dest = pair()

	let inj = injector(dest.sink)
	let state = 0
	inj(function (end, cb) {
		if (end)
			return cb(end, noop)

		switch (state++) {
			case 0:
				cb(null, Buffer.from([100]))
				break
			case 1:
				cb(new Error('error'))
				inj.inject(Buffer.from([103]))
				inj.abort()
				break
			default:
				t.fail('unexpected read call')
				break
		}
	})

	pull(dest, collect(function (err, data) {
		t.ok(err, 'got error')
		t.end()
	}))
})

test('sink ends', function (t) {
	let dest = pair()

	let inj = injector(dest.sink)
	let state = 0
	inj(function (end, cb) {
		if (end)
			return cb(end, noop)

		switch (state++) {
			case 0:
				cb(null, Buffer.from([100]))
				dest.source(true, function () {
					t.pass('aborted')
					t.end()
				})
				break
			default:
				cb(true)
				break
		}
	})

	pull(dest, collect(function (err, data) {
		if (err)
			return t.fail('error')
	}))
})
