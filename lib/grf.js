// This librarie extends default roBrowser software
// It extends roBrowser default GRF loader
// Giving it a set a new set of API's and replacing some performance critical functions
var Grf = module.exports = require('./Loaders/GameFile.js')
var Extractor = require('./extractor')

// Should we print debug messages?
Grf.prototype.printDebug = false

// Search for a pattern on the .grf file
// @param regexp: A regular expression instance
Grf.prototype.searchPattern = function search(regexp, callback) {
	var matches = []

	for(var i in this.entries) {
		var entry = this.entries[i]

		// Match against the decoded path (data/wav/x.wav) and the raw grf name (data\wav\x.wav)
		if(testPattern(regexp, entry.path) || testPattern(regexp, entry.filename)) {
			matches.push(entry)
		}
	}

	callback(matches)
}

// RegExp.test() is stateful with the g/y flags, always start from the beginning
function testPattern(regexp, str) {
	regexp.lastIndex = 0
	return typeof str === 'string' && regexp.test(str)
}

// Find a single entry by its path, either "data/x.xml" or "data\x.xml"
Grf.prototype.findEntry = function findEntry(name) {
	var pos = this.search(name.replace(/\//g, '\\').toLowerCase())

	if(pos !== -1) {
		return this.entries[pos]
	}

	var path = name.replace(/\\/g, '/').toLowerCase()

	for(var i = 0; i < this.entries.length; i++) {
		if(this.entries[i].path && this.entries[i].path.toLowerCase() === path) {
			return this.entries[i]
		}
	}

	return null
}

// Extract all files from the .grf to a folder
// @param options {
// 		output: output directory
// 		entries: subset of entries to extract (defaults to all)
// 		concurrency: concurrency rate
// }
Grf.prototype.extract = function(options) {
	return new Extractor(this, options)
}

// Print a debug message if verbosity is set
Grf.prototype.debug = function debug() {
	if(this.printDebug) {
		console.log.apply(this, arguments)
	}
}
