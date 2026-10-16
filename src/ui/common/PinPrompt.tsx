import { useState } from 'react';
import { Modal } from './Modal';

interface Props {
  onSubmit: (pin: string) => boolean;
  onCancel: () => void;
}

export function PinPrompt({ onSubmit, onCancel }: Props) {
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = () => {
    if (onSubmit(pin)) return;
    setWrong(true);
    setPin('');
  };
  return (
    <Modal
      title="Author PIN required"
      onClose={onCancel}
      actions={
        <>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={submit}>Unlock</button>
        </>
      }
    >
      <p className="hint">This exam is protected so the student cannot open the answer key by accident.</p>
      <input
        className="input"
        type="password"
        autoFocus
        value={pin}
        placeholder="PIN"
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {wrong && <p className="error">Wrong PIN.</p>}
    </Modal>
  );
}
