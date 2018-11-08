import { EventEmitter } from 'events';
import { promisify } from 'util';
import {
  notarizeAndSaveNoteToVault,
  notaryStatus,
  noteChanged
} from './notesReducer';
import hashNotary from './hashNotary';
import configureStore from '../../store/configureStore';
import { web3 } from '../signIn/uport';
import { signInSuccess } from '../signIn/signInReducer';
import { selectCurrentVaultRecord, selectCurrentNote } from './notesSelectors';

jest.mock('./hashNotary');

/**
 * Creates a mocked contract method
 *
 * @returns {Function} - A Mocked web3 Contract method
 */
const mockContractMethod = () => {
  const mockSendEmitter = new EventEmitter();
  const mockCall = jest.fn();

  const mockMethod = jest.fn().mockReturnValue({
    send: jest.fn().mockReturnValue(mockSendEmitter),
    call: mockCall
  });

  mockMethod._mockSendEmitter = mockSendEmitter;
  mockMethod._mockCall = mockCall;

  return mockMethod;
};

describe('Notes reducer', () => {
  const txHash = '0x0';
  const note = { id: '10', title: '10 is best', body: 'We all love David' };
  const noteHash = web3.utils.sha3(JSON.stringify(note));

  let store;
  let expectedTimestamp;

  beforeEach(() => {
    store = configureStore().store;
    expectedTimestamp = Math.floor(Date.now() / 1000);

    // Mock a log in with uport
    store.dispatch(
      signInSuccess({
        networkAddress: '2nQtiQG6Cgm1GYTBaaKAgr76uY7iSexUkqX'
      })
    );

    hashNotary.methods.save = mockContractMethod();
    hashNotary.methods.getTimestamp = mockContractMethod();

    hashNotary.methods.getTimestamp._mockCall.mockReturnValue(
      expectedTimestamp
    );
  });

  it('saves a status and a txHash for later on notary start', async () => {
    store.dispatch(notarizeAndSaveNoteToVault(note));

    hashNotary.methods.save._mockSendEmitter.emit('transactionHash', txHash);

    // Skip a tick for callbacks to pop off
    await promisify(setImmediate)();
    const vaultRecord = selectCurrentVaultRecord(store.getState(), {
      vaultRecord: noteHash
    });

    expect(vaultRecord).toEqual(
      expect.objectContaining({
        noteHash,
        notary: {
          status: notaryStatus.pending,
          txHash
        }
      })
    );
  });

  it('saves an error and status on failure', async () => {
    const error = new Error('A wild Dalek appeared');

    store.dispatch(notarizeAndSaveNoteToVault(note));

    hashNotary.methods.save._mockSendEmitter.emit('error', error);

    // Skip a tick for callbacks to pop off
    await promisify(setImmediate)();

    const vaultRecord = selectCurrentVaultRecord(store.getState(), {
      vaultRecord: noteHash
    });

    expect(vaultRecord).toEqual(
      expect.objectContaining({
        noteHash,
        notary: {
          status: notaryStatus.error,
          error
        }
      })
    );
  });

  it('saves the timestamp after 12 confirmations', async () => {
    store.dispatch(notarizeAndSaveNoteToVault(note));

    hashNotary.methods.save._mockSendEmitter.emit('transactionHash', txHash);
    // Simulate 24 confirmations
    new Array(24).fill('').forEach((val, index) => {
      hashNotary.methods.save._mockSendEmitter.emit('confirmation', index + 1);
    });

    // Skip a tick for callbacks to pop off
    await promisify(setImmediate)();
    const vaultRecord = selectCurrentVaultRecord(store.getState(), {
      vaultRecord: noteHash
    });

    expect(vaultRecord).toEqual(
      expect.objectContaining({
        noteId: note.id,
        noteHash,
        notary: {
          status: notaryStatus.confirmed,
          txHash,
          timestamp: expectedTimestamp
        }
      })
    );
  });

  it('can update an existing note', () => {
    const params = {
      navigation: {
        getParam: () => note.id
      }
    };

    const updatedNote = {
      ...note,
      title: note.title + ' ' + note.title
    };

    store.dispatch(noteChanged(note));
    expect(selectCurrentNote(store.getState(), params)).toEqual(
      expect.objectContaining(note)
    );

    store.dispatch(noteChanged(updatedNote));
    expect(selectCurrentNote(store.getState(), params)).toEqual(
      expect.objectContaining(updatedNote)
    );
  });
});
