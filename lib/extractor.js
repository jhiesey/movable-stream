const DATA_BLOCK = 0
const INJECTED_BLOCK = 1
const DATA_END = 2

const noop = function () {}

module.exports = function (initialStream, onEvent, name) {
	let s = initialStream
	let aborted = null
	let buffer = null
	let callback = null
	let ended = false
	// let newStream = null

	let source = function (end, cb) {
		console.log(name, 'EXTRACTOR READ', end)
		if (end) {
			console.log('BEGIN STACK')
			console.log(new Error().stack)
			console.log('END STACK')
		}

		let origCb = cb
		cb = function (e, d) {
			console.log(name, 'EXTRACTOR READ CB', e, d)
			origCb(e, d)
		}

		if (aborted) {
			console.log(name, 'EXTRACTOR ABORT', aborted)
			return cb(aborted)
		}

		callback = cb
		if (end) {
			return s(end, cb)
		}

		const pullIn = function () {
			const originalStream = s

			s(null, function (end, data) {
				if (originalStream !== s) {
					return originalStream(aborted || true) // end old stream
				}

				if (end) {
					return source.abort(end)
				}

				if (buffer)
					buffer = Buffer.concat([buffer, data])
				else
					buffer = data
				haveData()

			})
		}

		const bufferData = function (end, data) {
			// if (global.startMagic) {
			// 	console.log('EXTRACTOR bufferData', end, data)
			// }

			// TODO: is this needed here?
			// if (newStream) {
			// 	if (end) {
			// 		s = newStream
			// 		newStream = null
			// 		s(null, bufferData)
			// 	}
			// 	return
			// }

			if (end) {
				return source.abort(end)
			}

			if (buffer)
				buffer = Buffer.concat([buffer, data])
			else
				buffer = data
			haveData()
		}

		const haveData = function () {
			while (true) {
				const msgType = buffer[0]
				switch(msgType) {
					case DATA_BLOCK:
					case INJECTED_BLOCK:
						if (buffer.length < 5)
							return pullIn()
						const len = buffer.readUInt32BE(1)
						if (buffer.length < len + 5)
							return pullIn()

						const chunk = buffer.slice(5, len + 5)
						buffer = buffer.slice(len + 5)

						if (msgType === INJECTED_BLOCK) {
							let newStream = onEvent(chunk)
							if (newStream) {
								buffer = Buffer.alloc(0)
								s = newStream // TODO: is this right?
							}
							break
						} else {
							callback = null
							if (buffer.length === 0)
								buffer = null
							console.log(name, 'EXTRACTOR', null, chunk)
							return cb(null, chunk)
						}
					case DATA_END:
						buffer = buffer.slice(1)
						callback = null
						if (buffer.length === 0)
							buffer = null
						ended = true
						console.log(name, 'EXTRACTOR', true)
						return cb(true)
					default:
						throw new Error('unexpected byte in extractor stream')
				}

				if (buffer.length === 0) {
					buffer = null
					return pullIn()
				}
			}
		}

		if (buffer)
			haveData()
		else
			pullIn()

		// if main stream ended and callback called, keep pulling data in
		if (ended && !callback) {
			source(null, function () {})
		}
	}

	source.abort = function (err) {
		if (aborted)
			return
		aborted = err || true
		s(aborted, noop)

		if (callback) {
			console.log(name, 'EXTRACTOR ABORT', aborted)
			callback(aborted)
		}
	}

	return source
}
