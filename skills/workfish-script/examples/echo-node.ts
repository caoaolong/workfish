export const meta = {
  id: 'example-echo',
  name: 'Example Echo',
  version: '0.1.0',
  inputs: {
    message: { type: 'string' },
  },
  outputs: {
    result: { type: 'string' },
  },
};

export async function run(inputs: { message?: string }) {
  return { result: inputs.message ?? '' };
}
