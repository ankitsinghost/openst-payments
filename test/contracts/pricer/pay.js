// Copyright 2018 OpenST Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// ----------------------------------------------------------------------------
// Test: pay.js
//
// http://www.simpletoken.org/
//
// ----------------------------------------------------------------------------

const pricerUtils = require('./pricer_utils.js');

///
/// Test stories
///
/// fails to pay if beneficiary is null
/// fails to pay if _transferAmount is 0
/// fails to pay if _commissionAmount > 0 and _commissionBeneficiary is null
/// successfully pays
/// when currency is not empty
///   fails to pay if pricePoint is not > 0
///   fails to pay if pricePoint is not in range
///   successfully pays

module.exports.perform = (accounts) => {
  const opsAddress            = accounts[1],
        abcPrice              = new pricerUtils.bigNumber(20 * 10**18),
        conversionRate        = 10,
        transferAmount        = new pricerUtils.bigNumber(5 * 10**18),
        commissionAmount      = new pricerUtils.bigNumber(1.25 * 10**18),
        beneficiary           = accounts[2],
        commissionBeneficiary = accounts[3]
        ;

  var response           = null,
      intendedPricePoint = null
      ;

  before(async () => {
    contracts      = await pricerUtils.deployPricer(artifacts, accounts);
    token          = contracts.token;
    pricer         = contracts.pricer;
    abcPriceOracle = contracts.abcPriceOracle;
    await pricer.setPriceOracle(pricerUtils.currencies.abc, abcPriceOracle.address, { from: opsAddress });
    intendedPricePoint = await pricer.getPricePoint.call(pricerUtils.currencies.abc);
    await token.setBalance(accounts[0], new pricerUtils.bigNumber(100 * 10**18));
  });

	it('fails to pay if beneficiary is null', async () => {
    await token.approve(pricer.address, transferAmount.plus(commissionAmount));
    await pricerUtils.utils.expectThrow(pricer.pay.call(
      0, transferAmount, commissionBeneficiary, commissionAmount, '', intendedPricePoint));
  });

  it('fails to pay if _transferAmount is 0', async () => {
    await token.approve(pricer.address, transferAmount.plus(commissionAmount));
    await pricerUtils.utils.expectThrow(pricer.pay.call(
      beneficiary, 0, commissionBeneficiary, commissionAmount, '', intendedPricePoint));
  });

  it('fails to pay if _commissionAmount > 0 and _commissionBeneficiary is null', async () => {
    await token.approve(pricer.address, transferAmount.plus(commissionAmount));
    await pricerUtils.utils.expectThrow(pricer.pay.call(
      beneficiary, transferAmount, 0, commissionAmount, '', intendedPricePoint));
  });

  it('successfully pays', async () => {
    // without commission
    await token.setBalance(beneficiary, 0);
    assert.equal(await token.balanceOf.call(beneficiary), 0);

    await token.approve(pricer.address, transferAmount);
    assert.ok(await pricer.pay.call(beneficiary, transferAmount, 0, 0, '', 0));
    response = await pricer.pay(beneficiary, transferAmount, 0, 0, '', 0);
    assert.equal((await token.balanceOf(beneficiary)).toNumber(), transferAmount);
    // When currency is blank, transferAmount is equal to tokenAmount
    checkPaymentEvent(response.logs[0], beneficiary, transferAmount, 0, 0, '', 0);
    pricerUtils.utils.logResponse(response, 'Pricer.pay: ' + transferAmount);

    // with commission
    // reset token balances to 0
    await token.setBalance(beneficiary, 0);
    await token.setBalance(commissionBeneficiary, 0);

    assert.equal(await token.balanceOf.call(beneficiary), 0);
    assert.equal(await token.balanceOf.call(commissionBeneficiary), 0);
    await token.approve(pricer.address, transferAmount.plus(commissionAmount));
    assert.ok(await pricer.pay.call(beneficiary, transferAmount, commissionBeneficiary, commissionAmount, '', 0));
    response = await pricer.pay(beneficiary, transferAmount, commissionBeneficiary, commissionAmount, '', 0);
    assert.equal((await token.balanceOf(beneficiary)).toNumber(), transferAmount);
    assert.equal((await token.balanceOf(commissionBeneficiary)).toNumber(), commissionAmount);
    // When currency is blank, transferAmount is equal to tokenAmount
    checkPaymentEvent(response.logs[0], beneficiary, transferAmount, commissionBeneficiary, commissionAmount, '', 0);
    pricerUtils.utils.logResponse(response, 'Pricer.pay: ' + transferAmount.plus(commissionAmount));
  });

  context('when currency is not empty', async () => {
    it('fails to pay if pricePoint is not > 0', async () => {
      await pricerUtils.utils.expectThrow(pricer.pay.call(
        beneficiary, transferAmount, 0, 0, pricerUtils.currencies.xyz, intendedPricePoint));
    });

    it('fails to pay if pricePoint is not in range', async () => {
      await pricerUtils.utils.expectThrow(pricer.pay.call(
        beneficiary, transferAmount, 0, 0, pricerUtils.currencies.abc, intendedPricePoint.plus(1)));
    });

    it('successfully pays', async () => {
      // reset token balances to 0
      await token.setBalance(beneficiary, 0);
      assert.equal(await token.balanceOf.call(beneficiary), 0);

      // get amount of tokens from currency value
      var calculatedResponse = (await pricer.getPricePointAndCalculatedAmounts.call(
      transferAmount, commissionAmount, pricerUtils.currencies.abc));

      var convertedTokenTransferAmount = calculatedResponse[1];

      await token.approve(pricer.address, convertedTokenTransferAmount);
      assert.ok(await pricer.pay.call(beneficiary, transferAmount, 0, 0, pricerUtils.currencies.abc, intendedPricePoint));
      response = await pricer.pay(beneficiary, transferAmount, 0, 0, pricerUtils.currencies.abc, intendedPricePoint);
      assert.equal((await token.balanceOf(beneficiary)).toNumber(), convertedTokenTransferAmount);

      // Note: Payment event publishes unconverted values--this is OK because the Transfer event will show convertedTransferAmount
      checkPaymentEvent(response.logs[0], beneficiary, convertedTokenTransferAmount, 0, 0, pricerUtils.currencies.abc, intendedPricePoint);
      pricerUtils.utils.logResponse(response, 'Pricer.pay (currency): ' + transferAmount);
    });

  });

}

function checkPaymentEvent(event, _beneficiary, _tokenAmount, _commissionBeneficiary, _commissionTokenAmount, _currency, _intendedPricePoint) {
  assert.equal(event.event, 'Payment');
  assert.equal(event.args._beneficiary, _beneficiary);
  assert.equal(event.args._tokenAmount.toNumber(), _tokenAmount);
  assert.equal(event.args._commissionBeneficiary, _commissionBeneficiary);
  assert.equal(event.args._commissionTokenAmount.toNumber(), _commissionTokenAmount);
  if (_currency) {
    assert.equal(web3.toAscii(event.args._currency), _currency);
  }
  assert.equal(event.args._intendedPricePoint.toNumber(), _intendedPricePoint);
}