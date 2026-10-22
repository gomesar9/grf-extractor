// Grf full extraction
var GRF = require('./Loaders/GameFile.js')
var GameFileDecrypt = require('./Loaders/GameFileDecrypt.js')
var EventEmitter = require('events').EventEmitter
var Cluster = require('cluster')
var Os = require('os')
var Fs = require('fs')
var Path = require('path')
var Util = require('util')
var Zlib = require('zlib')

// Constructor
var Extractor = function Constructor(grf, options) {
	this._progress = 0
	this.grf = grf
	this.entries = options.entries || grf.entries
	this.concurrency = options.concurrency || 100
	this.output_dir = Path.resolve(options.output || '.')
	this.mkdirPaths = {} // List of paths already created

	// Start at next tick, give time for event listener to bind
	process.nextTick(extractStart.bind(this))

	return this
}

// Event emmiter
Util.inherits(Extractor, EventEmitter);

// Resolve an entry path inside the output folder
// Returns null if the entry tries to escape it (absolute path, drive letter, "..")
function resolveEntryPath(root, entryPath) {
	var parts = entryPath.split(/[\\/]+/).filter(function(part) {
		return part !== '' && part !== '.'
	})

	for(var i = 0; i < parts.length; i++) {
		if(parts[i] === '..' || parts[i].indexOf(':') !== -1 || parts[i].indexOf('\0') !== -1) {
			return null
		}
	}

	var fullpath = Path.resolve(root, parts.join(Path.sep))

	if(fullpath !== root && fullpath.indexOf(root + Path.sep) !== 0) {
		return null
	}

	return fullpath
}

// Start the extraction
function extractStart() {
	var cluster = Cluster
	var grf = this.grf
	var all_entries = this.entries
	var numCpus = Math.max(1, Math.min(Os.cpus().length, all_entries.length))
	var concurrency = this.concurrency
	var extract_folder = this.output_dir
	var self = this

	// The master only spawn workers to work on the GRF
	// And receives progress updates
	if(cluster.isPrimary || cluster.isMaster) {
		// Fork some workers
		for(var i = 0; i < numCpus; i++) {
			cluster.fork()
		}

		// Workers online
		var workers = []

		// Separate the entries table into the number of workers
		var entries_slices = [{
			start: 0,
			end: 0,
		}]
		var last = 0
		var chunk_size = Math.floor(all_entries.length / numCpus)
		
		for(var i = 0; i < numCpus; i++) {
			next = last + chunk_size 

			// If last iteration, set this slice to the rest of the entries array
			if(i == numCpus - 1) {
				next = all_entries.length
			}

			entries_slices[i] = {
				start: last,
				end: next,
			}

			last = next
		}

		// A worker is online, send it work :)
		cluster.on('online', function(worker) {
			var worker_id = workers.length

			// Send a slice of the entries table to this worker to process
			var slice = entries_slices[ worker_id ]
			worker.send(slice)

			grf.debug("Sending to worker #%d slice %d to %d.", worker_id, slice.start, slice.end)

			// Worker is reporting its progress
			worker.on('message', function(msg) {
				if(msg.cmd == 'progress') {
					self._progress++	
				}
			})

			// Register worker
			workers.push(worker)	
		})
		
		self.emit('start')

		return
	}

	// Else is, worker
	// Wait for the master to send us the go signal 
	process.on('message', function(msg) {
		// Receive a slice to work on
		var entries = all_entries.slice(msg.start, msg.end)
		var next = 0
		
		grf.debug("Worker received slice from %d to %d to work on.", msg.start, msg.end)
		grf.debug('Worker extracting', entries.length, 'files.')

		// Launch # concurrent extractors
		for(var i = 0; i < concurrency; i++){
			extract_next()
		}

		function extract_next() {
			if(next >= entries.length) {
				return 
			}

			var i = next++
			var entry = entries[i]
			var fullpath = resolveEntryPath(extract_folder, entry.path || entry.filename)

			if(fullpath === null) {
				console.error("Skipping unsafe entry path %s", entry.path || entry.filename)
				finish()
				return
			}

			if(entry.type & GRF.FILELIST_TYPE_FILE) {
				if(!grf.isEntryInBounds(entry)) {
					console.error("Skipping %s, its data points outside of the grf", fullpath)
					finish()
					return
				}

				var buffer = Buffer.alloc(entry.length_aligned)


				// Read entry from .grf file
				Fs.read(grf.file.fd, buffer, 0, entry.length_aligned, entry.offset + GRF.struct_header.size, function(err, bytesRead, buffer){
					if(err) {
						console.error("Unexpected error while reading file %s from grf", fullpath)
						console.error(err)
						finish()
						return
					}

					// Write entry to file
					self.writeEntry(entry, fullpath, buffer, finish)	
				})
			}
			// Directory?
			else {
				self.makeDir(fullpath, finish)
			}
	
			// Extract next
			function finish() {
				// Notify master of progress
				process.send({cmd: 'progress'})
				extract_next()
			}
		}
	})

	// Avoid workers crashing because of excpections
	process.on('uncaughtException', function(err) {
		console.error(err)	
	})
}

// Progress
Extractor.prototype.progress = function progress() {
	return this._progress
}

// Make a directory
Extractor.prototype.makeDir = function mkDir(path, callback) {					
	// Create directoy
	if(typeof this.mkdirPaths[path] === 'undefined') {
		var self = this

		Fs.mkdir(path, { recursive: true }, function (err) {
			if(err) {
				console.error("Unexpected error while trying to create dir", path)
				console.error(err)
			}

			// Add to created paths hashtable
			self.mkdirPaths[path] = true

			callback()
		})

		return
	}

	// Directoy already exixsts
	callback()
}	

// Write entry buffer to a file
Extractor.prototype.writeEntry = function writeEntry(entry, path, buffer, callback) {
	// Decode buffer if needed
	if (entry.type & GRF.FILELIST_TYPE_ENCRYPT_MIXED) {
		var data = new Uint8Array(buffer)
		GameFileDecrypt.decodeFull( data, entry.length_aligned, entry.pack_size)
		buffer = Buffer.from(data)
	}
	else if (entry.type & GRF.FILELIST_TYPE_ENCRYPT_HEADER) {
		var data = new Uint8Array(buffer)
		GameFileDecrypt.decodeHeader( data, entry.length_aligned )
		buffer = Buffer.from(data)
	}

	var self = this

	// Decompress the buffer, never past the declared size (zip bomb guard)
	Zlib.inflate(buffer, { maxOutputLength: Math.max(entry.real_size, 1) }, function(err, buf) {
		if(err) {
			console.error("Unexpected error while inflating", path)
			console.error(err)
			callback()
			return
		}

		self.makeDir(Path.dirname(path), function() {
			self.writeFile(path, buf, callback)
		})
	})
}

// Write buffer to file
Extractor.prototype.writeFile = function writeFile(path, buffer, callback) {
	Fs.writeFile(path, buffer, function (err) {
		if (err) {
			console.error("Unexpected error while writing %s to file", path)
			console.error(err)
		}

		callback()
	})					
}

// Exports
module.exports = Extractor
