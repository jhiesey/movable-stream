const test = require('tape')
const pull = require('pull-stream')
const pair = require('pull-pair')
const collect = require('pull-stream/sinks/collect')
const values = require('pull-stream/sources/values')

const extractor = require('../lib/extractor')

test('simple', function (t) {
	let src = pair()

	let state = 0
	let ext = extractor(values([
		Buffer.from([0]),
		Buffer.from([0]),
		Buffer.from([0]),
		Buffer.from([0]),
		Buffer.from([1]),
		Buffer.from([100]),

		Buffer.from([1,0,0,0,1,101]),
		Buffer.from([0,0,0,0,1,102,2]),
		Buffer.from([1,0,0,0,1,103])
	]), function (buf) {
		switch(state++) {
			case 0:
				t.ok(buf.equals(Buffer.from([101])), 'first injection')
				break
			case 1:
				t.ok(buf.equals(Buffer.from([103])), 'second injection')
				break
			default:
				t.fail('unexpected event')
				break
		}
		return null // don't replace stream
	})

	pull(ext, collect(function (err, data) {
		if (err)
			return t.fail('error')
		let all = Buffer.concat(data)
		t.ok(all.equals(Buffer.from([100,102])), 'correct data')
		t.end()
	}))
})

test('switching', function (t) {
	let src = pair()

	let state = 0
	let ext = extractor(values([
		Buffer.from([0,0,0,0,1,100]),
		Buffer.from([1,0,0,0,1,101])
	]), function (buf) {
		switch(state++) {
			case 0:
				t.ok(buf.equals(Buffer.from([101])), 'first injection')
				return values([
					Buffer.from([0,0,0,0,1,102,2]),
					Buffer.from([1,0,0,0,1,103])
				])
			case 1:
				t.ok(buf.equals(Buffer.from([103])), 'second injection')
				break
			default:
				t.fail('unexpected event')
				break
		}
		return null // don't replace stream
	})

	pull(ext, collect(function (err, data) {
		if (err)
			return t.fail('error')
		let all = Buffer.concat(data)
		t.ok(all.equals(Buffer.from([100,102])), 'correct data')
		t.end()
	}))
})

test('abort', function (t) {
	let src = pair()

	let state = 0
	let ext = extractor(values([
		Buffer.from([0,0,0,0,1,100]),
		Buffer.from([1,0,0,0,1,101])
	]), function (buf) {
		switch(state++) {
			case 0:
				t.ok(buf.equals(Buffer.from([101])), 'first injection')
				ext.abort()
				ext.abort()
				break
			default:
				t.fail('unexpected event')
				break
		}
		return null // don't replace stream
	})

	pull(ext, collect(function (err, data) {
		if (err)
			return t.fail('error')
		let all = Buffer.concat(data)
		t.ok(all.equals(Buffer.from([100])), 'correct data')
		t.end()
	}))
})

test('sink errors', function (t) {
	let src = pair()

	let state = 0
	let ext = extractor(values([
		Buffer.from([0,0,0,0,1,100]),
		Buffer.from([1,0,0,0,1,101])
	], function (err) {
		t.ok(err, 'got error')
		t.end()
	}), function (buf) {
		t.fail('unexpected event')
		return null // don't replace stream
	})

	ext(new Error('error'), function () {})
})

test('source ends', function (t) {
	let src = pair()

	let state = 0
	let ext = extractor(values([
		Buffer.from([0,0,0,0,1,100]),
	]), function (buf) {
		t.fail('unexpected event')
		return null // don't replace stream
	})

	pull(ext, collect(function (err, data) {
		if (err)
			return t.fail('error')
		let all = Buffer.concat(data)
		t.ok(all.equals(Buffer.from([100])), 'correct data')
		t.end()
	}))
})
