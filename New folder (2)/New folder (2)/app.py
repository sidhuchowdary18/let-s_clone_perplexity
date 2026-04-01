from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import google.generativeai as genai
import os

app = Flask(__name__, static_folder='.')
CORS(app)

# ─── Gemini 2.5 Flash Configuration ───
API_KEY = "AIzaSyAwaEJPXy3bpalGn0ELbJniswcSCLhEtl8"
genai.configure(api_key=API_KEY)

model = genai.GenerativeModel('gemini-2.5-flash')

# Store conversation history for context-aware responses
conversation_history = []

# ─── Serve Frontend ───
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('.', filename)

# ─── Chat Endpoint ───
@app.route('/ask', methods=['POST'])
def ask_gemini():
    data = request.json
    user_query = data.get('query', '')

    if not user_query:
        return jsonify({"error": "No query provided"}), 400

    try:
        # Build context from conversation history (last 10 turns)
        context_messages = []
        for entry in conversation_history[-10:]:
            context_messages.append({"role": "user", "parts": [entry["user"]]})
            context_messages.append({"role": "model", "parts": [entry["model"]]})

        # Start a chat with history for context
        chat = model.start_chat(history=context_messages)
        response = chat.send_message(user_query)

        # Store this turn in history
        conversation_history.append({
            "user": user_query,
            "model": response.text
        })

        return jsonify({
            "response": response.text,
            "status": "success"
        })

    except Exception as e:
        print(f"❌ Gemini API Error: {str(e)}")
        return jsonify({
            "error": str(e),
            "status": "failed"
        }), 500

# ─── Clear History ───
@app.route('/clear', methods=['POST'])
def clear_history():
    global conversation_history
    conversation_history = []
    return jsonify({"status": "success", "message": "Conversation history cleared"})

# ─── Health Check ───
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "model": "gemini-2.5-flash",
        "history_length": len(conversation_history)
    })

if __name__ == '__main__':
    print("═" * 50)
    print("  🤖  Claude Backend (Gemini 2.5 Flash)")
    print("═" * 50)
    print("  🌐  App:      http://localhost:5000")
    print("  🔗  API:      http://localhost:5000/ask")
    print("  💊  Health:   http://localhost:5000/health")
    print("  🧹  Clear:    POST http://localhost:5000/clear")
    print("═" * 50)
    app.run(debug=True, port=5000, host='0.0.0.0')
