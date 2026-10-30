meta = {
  "id": "example-echo",
  "name": "Example Echo",
  "version": "0.1.0",
  "inputs": {
    "message": { "type": "string" }
  },
  "outputs": {
    "result": { "type": "string" }
  }
}

async def run(inputs):
    message = inputs.get("message", "") if isinstance(inputs, dict) else ""
    return {"result": message}
