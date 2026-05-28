import asyncio
import json
import websockets

async def main():
    async with websockets.connect("ws://localhost:5029/ws") as ws:
        try:
            hello = await ws.recv()
            print("hello:", json.loads(hello))
        except Exception as e:
            print("hello error:", e)

        while True:
            try:
                msg = await ws.recv()
                print("event:", msg)
            except Exception as e:
                print("socket closed:", e)
                break

asyncio.run(main())
