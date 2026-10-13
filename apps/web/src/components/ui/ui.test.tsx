import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, Field, Input, StatusBadge } from './index';
import { toPayload } from '../../features/incoming-letters/components';

describe('StatusBadge', () => {
  it('renders Indonesian labels', () => {
    render(<StatusBadge kind="letter" value="AWAITING_DISPOSITION" />);
    expect(screen.getByText('Menunggu disposisi')).toBeInTheDocument();
  });
});

describe('Field', () => {
  it('links label, control and error for assistive technology', () => {
    render(
      <Field label="Perihal" error="Wajib diisi" required>
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText(/Perihal/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Wajib diisi');
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });
});

describe('ConfirmDialog', () => {
  it('requires a reason of at least 5 characters', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onClose={() => undefined} onConfirm={onConfirm} title="Batalkan?" message="Yakin?" requireReason confirmLabel="Ya" />);
    await userEvent.click(screen.getByRole('button', { name: 'Ya' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Minimal 5 karakter')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Alasan/), 'Salah unggah');
    await userEvent.click(screen.getByRole('button', { name: 'Ya' }));
    expect(onConfirm).toHaveBeenCalledWith('Salah unggah');
  });
});

describe('toPayload', () => {
  it('converts empty strings to null', () => {
    expect(toPayload({ subject: 'Rapat', letterNumber: '' })).toEqual({ subject: 'Rapat', letterNumber: null });
  });
});
