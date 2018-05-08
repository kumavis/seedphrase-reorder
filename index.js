const bip39 = require('bip39')
const bip39WorldList = require('bip39/wordlists/english.json')
const HdKeyring = require('eth-hd-keyring')
const Ethjs = require('ethjs')
const PromisePool = require('es6-promise-pool')
const prettyMs = require('pretty-ms')
const argv = require('yargs').argv

// better to NOT use the infura REST api, as it will move a lot of garbage into cache
const eth = new Ethjs(new Ethjs.HttpProvider('https://mainnet.infura.io/metamask'))


start().catch(console.error)

async function start() {
  const seedPhrase = argv.m
  if (!seedPhrase) throw new Error(`No seed phrase specified - Must specify seed phrase with "-m 'decline fame ...'"`)
  if (seedPhrase.split(' ').length < 12) throw new Error(`Invalid seed phrase specified - Must specify seed phrase with "-m 'decline fame ...'"`)
  await lookForNeighborsInUse({ seedPhrase })
  console.log('completed search')
}

function reportFoundSeedPhrase(seedPhrase) {
  console.log(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`)
  console.log(`!!!!! found matching seed phrase: ${seedPhrase} !!!!!`)
  console.log(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`)
  process.exit()
}

async function lookForNeighborsInUse({ seedPhrase }) {
  const neighbors = createNeighborIterator({ seedPhrase })
  let checkedCount = 0
  const concurrency = 100
  const startTime = Date.now()
  await eachLimit(neighbors, async (neighbor) => {
    const inUse = await checkSeedPhraseForUse({ seedPhrase: neighbor })
    checkedCount++
    // occasional status updates
    if (checkedCount % 1000 === 0) {
      const duration = (Date.now() - startTime)
      const rate = checkedCount / duration
      const rateSec = rate * 1000
      // experimental results
      const validRate = 0.0625
      // 12! (factorial)
      const totalPermutations = 479001600
      const validPermuations = totalPermutations * validRate
      const percentComplete = 100 * checkedCount / validPermuations
      const timeRemaining = (validPermuations - checkedCount) / rate
      console.log(`checked ${checkedCount} valid seed phrases at ${rateSec.toFixed(1)}/sec estimated ${percentComplete.toFixed(2)}% ${prettyMs(timeRemaining)} remaining`)
    }
    if (!inUse) return
    // this halts the process because we dont have a means to abort eachLimit
    reportFoundSeedPhrase(neighbor)
  }, concurrency)
}

async function checkSeedPhraseForUse({ seedPhrase }) {
  const isValid = bip39.validateMnemonic(seedPhrase)
  const accounts = await generateAccounts({ seedPhrase })
  // console.log(`checking balances for ${accounts}`)
  const balances = await Promise.all(accounts.map(address => eth.getBalance(address)))
  // console.log(`saw balances ${balances}`)
  const inUse = balances.some(balance => balance.toNumber() > 0)
  return inUse
}

async function generateAccounts({ seedPhrase }) {
  const keyring = new HdKeyring({
    mnemonic: seedPhrase,
    numberOfAccounts: 1,
  })
  const accounts = await keyring.getAccounts()
  return accounts
}

// returns an iterator that steps through each valid reordering of a seed phrase
function* createNeighborIterator({ seedPhrase }) {
  const wordIndices = phraseToIndices(seedPhrase)
  const neighbors = createArrayPermutator(wordIndices)
  for (let neighborIndices of neighbors) {
    const neighborPhrase = indicesToPhrase(neighborIndices)
    // const isValid = bip39.validateMnemonic(neighborPhrase)
    // if (isValid) yield neighborPhrase
    yield neighborPhrase
  }
}

// returns an iterator that steps through each possible iteration of a seed phrase
function* createArrayPermutator (array) {
  // short cuts
  if (array.length === 0) return
  if (array.length === 1) {
    yield array
    return
  }
  // recursively find permutations
  for (let index = 0; index < array.length; index++) {
    // select current element
    const currentElement = array[index]
    // create sub-array without current element
    const subArray = array.slice(0,index).concat(array.slice(index+1))
    // get permutations of sub-array
    const subArrayPermutations = createArrayPermutator(subArray)
    // re-insert current element at the beginning of each child array permutation
    for (let childPermutation of subArrayPermutations) {
      const permutation = [currentElement].concat(childPermutation)
      yield permutation
    }
  }
}


function phraseToIndices(seedPhrase) {
  return seedPhrase.split(' ').map(word => bip39WorldList.indexOf(word))
}

function indicesToPhrase(wordIndices) {
  return wordIndices.map(index => bip39WorldList[index]).join(' ')
}

async function eachLimit(iterator, asyncFn, concurrency) {
  const pool = new PromisePool(() => {
    const next = iterator.next()
    if (next.done) return null
    return asyncFn(next.value)
  }, concurrency)
  return pool.start()
}
