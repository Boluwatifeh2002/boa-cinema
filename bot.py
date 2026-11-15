from dotenv import load_dotenv
load_dotenv()
import os
import asyncio
import time
import math
import sys
# 1. Python 3.15 Windows Event Loop Setup
asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
try:
    loop = asyncio.get_event_loop()
    if loop.is_closed():
        raise RuntimeError()
except RuntimeError:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

# 2. Imports
import requests
from pyrogram import Client, filters

# 3. Automatically create the 'sessions' folder if it doesn't exist yet
os.makedirs("sessions", exist_ok=True)
app = Client(
    "sessions/my_leech_bot",
    api_id=int(os.environ.get("API_ID")),
    api_hash=os.environ.get("API_HASH"),
    bot_token=os.environ.get("BOT_TOKEN")
)

# Define your target destinations here
MAIN_CHANNEL = "@boasentertainment"
SERIES_CHANNEL = "@boaseriesupload"

# Security: Restrict bot usage exclusively to your User ID
ADMIN_USER_ID = int(os.environ.get("OWNER_ID"))

# Task queue and active tasks tracking
task_queue = asyncio.Queue()
ACTIVE_DOWNLOADS = set()

def human_readable_size(size_in_bytes):
    """Converts raw bytes into human-readable strings (KB, MB, GB)."""
    if not size_in_bytes:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    i = int(math.floor(math.log(size_in_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_in_bytes / p, 2)
    return f"{s} {units[i]}"

def time_formatter(seconds):
    """Formats seconds into readable MM:SS or HH:MM:SS format."""
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"

async def upload_progress(current, total, status_msg, filename, start_time, last_update_time):
    """Renders a styled upload progress bar with bytes, speed, and ETA."""
    now = time.time()
    if now - last_update_time[0] < 3 and current != total:
        return
        
    last_update_time[0] = now
    elapsed = now - start_time
    speed = current / elapsed if elapsed > 0 else 0
    eta = (total - current) / speed if speed > 0 else 0
    percentage = (current * 100 / total) if total > 0 else 0
    
    completed_blocks = int(percentage // 10)
    bar = "█" * completed_blocks + "░" * (10 - completed_blocks)
    
    progress_text = (
        f"📤 <b>Uploading `{filename}`...</b>\n\n"
        f"📊 <b>Progress:</b> [{bar}] <code>{percentage:.1f}%</code>\n"
        f"⚡ <b>Transfer:</b> <code>{human_readable_size(current)} / {human_readable_size(total)}</code>\n"
        f"🚀 <b>Speed:</b> <code>{human_readable_size(speed)}/s</code>\n"
        f"⏱️ <b>ETA:</b> <code>{time_formatter(eta)}</code>"
    )
    try:
        await status_msg.edit(progress_text)
    except Exception:
        pass

def download_file(url, local_filename):
    # Sanitize URL from backslashes universally
    url = url.replace("\\", "").strip()
    
    # Generic browser headers compatible with any hosting site
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    print(f"\n>>> Downloading from URL: {url}")
    
    error_count = 0
    was_offline = False
    
    while True:
        try:
            print(">>> Connecting...")
            response = requests.get(url, headers=headers, stream=True, timeout=60)
            response.raise_for_status()
            
            # Universal Protection: Check if the site returned an HTML landing page instead of a video
            content_type = response.headers.get("content-type", "").lower()
            if "text/html" in content_type:
                raise ValueError("Link returned an HTML webpage/landing page instead of a direct media file. Please provide a direct download link.")
            
            if was_offline:
                print(">>> Connection restored!")
            else:
                print(">>> Connection secured!")
            break
            
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            was_offline = True
            error_count += 1
            print(f">>> Unable to connect due to network issues: {e}. Trying again...")
            time.sleep(5)
        except Exception as e:
            raise e
            
    total_size = int(response.headers.get('content-length', 0))
    downloaded = 0
    
    with open(local_filename, "wb") as f:
        for chunk in response.iter_content(chunk_size=65536):
            if chunk:
                # Double-check the first chunk for HTML headers just in case
                if downloaded == 0 and (chunk.startswith(b"<!DOCTYPE") or chunk.startswith(b"<html") or chunk.startswith(b"<head")):
                    raise ValueError("Link returned an HTML landing page instead of a media file. Please provide a direct download link.")
                
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    percent = (downloaded / total_size) * 100
                    print(f"\r>>> Progress: {downloaded / (1024*1024):.2f} MB / {total_size / (1024*1024):.2f} MB ({percent:.1f}%)   ", end="")
                else:
                    print(f"\r>>> Downloaded: {downloaded / (1024*1024):.2f} MB   ", end="")
    print("\n>>> Download finished!")

# Background worker that processes links strictly one by one
async def queue_worker():
    while True:
        task = await task_queue.get()
        client, message, target_chat, url, filename = task
        
        ACTIVE_DOWNLOADS.add(filename)
        status_msg = await message.reply(f"📥 Queued & starting download for: `{filename}`...")
        
        try:
            loop_exec = asyncio.get_running_loop()
            await loop_exec.run_in_executor(None, download_file, url, filename)
            
            print(f">>> Uploading {filename} to {target_chat} as a document...")
            await status_msg.edit(f"📤 Initializing secure upload for `{filename}`...")
            
            await asyncio.sleep(2)
            
            start_time = time.time()
            last_update_time = [0]
            
            await client.send_document(
                chat_id=target_chat,
                document=filename,
                caption=f"<b>{filename}</b>\nDownload & Enjoy ❤",
                force_document=True,
                progress=upload_progress,
                progress_args=(status_msg, filename, start_time, last_update_time)
            )
            
            if os.path.exists(filename):
                os.remove(filename)
                
            print(">>> Upload complete!")
            await status_msg.edit(f"✅ Successfully uploaded `{filename}`!")
            
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"\n>>> Error: {e}")
            if os.path.exists(filename):
                os.remove(filename)
            try:
                await status_msg.edit(f"❌ **Process Canceled:** `{filename}` stopped (`{e}`).")
            except Exception:
                pass
                
        finally:
            ACTIVE_DOWNLOADS.discard(filename)
            task_queue.task_done()
            await asyncio.sleep(3)

@app.on_message(filters.text)
async def message_handler(client, message):
    if not message.from_user or message.from_user.id != ADMIN_USER_ID:
        return
        
    text = message.text.strip()
    print(f"\n>>> RECEIVED MESSAGE:\n{text}")
    
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if not lines:
        return
        
    first_line = lines[0]
    is_movie = first_line.startswith("/movie")
    is_series = first_line.startswith("/series")
    
    if not (is_movie or is_series):
        return
        
    target_chat = MAIN_CHANNEL if is_movie else SERIES_CHANNEL
    command_name = "/movie" if is_movie else "/series"
    
    if len(lines) == 1:
        parts = first_line.split(maxsplit=2)
        if len(parts) < 2:
            await message.reply(f"Please provide a direct link. Usage:\n`{command_name} <url> <filename>`")
            return
            
        url = parts[1].strip().replace("\\", "")
        filename = parts[2].strip().replace(" ", "_") if len(parts) > 2 else "video.mkv"
        
        if filename in ACTIVE_DOWNLOADS or any(filename == item[4] for item in task_queue._queue):
            await message.reply(f"⚠️ `{filename}` is already in the queue or downloading!")
            return

        await task_queue.put((client, message, target_chat, url, filename))
        await message.reply(f"📌 Added `{filename}` to the sequential processing queue.")
    else:
        queued_count = 0
        for idx, line in enumerate(lines[1:], start=1):
            parts = line.split(maxsplit=1)
            if not parts:
                continue
            url = parts[0].strip().replace("\\", "")
            if not (url.startswith("http://") or url.startswith("https://")):
                continue
                
            filename = parts[1].strip().replace(" ", "_") if len(parts) > 1 else f"media_{int(time.time())}_{idx}.mkv"
            
            if filename in ACTIVE_DOWNLOADS or any(filename == item[4] for item in task_queue._queue):
                continue
                
            await task_queue.put((client, message, target_chat, url, filename))
            queued_count += 1
            
        if queued_count > 0:
            await message.reply(f"🚀 **Bulk Queue Success!** Added <b>{queued_count}</b> items to the sequential processing queue.")
        else:
            await message.reply("⚠️ No valid HTTP/HTTPS links found.")

async def main():
    print(">>> Starting Pyrogram Bot natively...")
    await app.start()
    
    worker_task = asyncio.create_task(queue_worker())
    
    me = await app.get_me()
    print(f">>> SUCCESS! Logged in as: {me.first_name} (@{me.username})")
    print(">>> Bot is online and listening for commands...")
    
    shutdown_event = asyncio.Event()
    try:
        await shutdown_event.wait()
    finally:
        worker_task.cancel()
        if app.is_connected:
            await app.stop()

if __name__ == "__main__":
    try:
        loop.run_until_complete(main())
    except KeyboardInterrupt:
        print("\n>>> Bot stopped gracefully via KeyboardInterrupt.")