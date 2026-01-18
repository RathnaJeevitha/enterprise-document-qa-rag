from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader
import io
from groq import AsyncGroq

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Initialize ChromaDB
chroma_client = chromadb.Client(Settings(
    persist_directory="./chroma_data",
    anonymized_telemetry=False
))



try:
    collection = chroma_client.get_collection(name="documents")
    logger.info("Loaded existing ChromaDB collection")
except Exception:
    collection = chroma_client.create_collection(name="documents")
    logger.info("Created new ChromaDB collection")



# Initialize sentence transformer
embedding_model = SentenceTransformer('all-MiniLM-L6-v2')

# Initialize Groq client
groq_client = AsyncGroq(api_key=os.environ.get('GROQ_API_KEY'))

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")



# Models
class Document(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    upload_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    num_chunks: int
    file_size: int

class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str
    answer: str
    sources: List[str]
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class QuestionRequest(BaseModel):
    question: str

class AnswerResponse(BaseModel):
    answer: str
    sources: List[dict]

# Helper functions
def extract_text_from_pdf(pdf_file):
    """Extract text from PDF file"""
    try:
        pdf_reader = PdfReader(io.BytesIO(pdf_file))
        text = ""
        for page_num, page in enumerate(pdf_reader.pages, 1):
            page_text = page.extract_text()
            text += f"[Page {page_num}]\n{page_text}\n\n"
        return text
    except Exception as e:
        logger.error(f"Error extracting text from PDF: {e}")
        raise

def chunk_text(text, chunk_size=500, overlap=50):
    """Split text into chunks with overlap"""
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = ' '.join(words[i:i + chunk_size])
        if chunk:
            chunks.append(chunk)
    return chunks

def extract_page_from_chunk(chunk_text):
    """Extract page number from chunk text"""
    import re
    match = re.search(r'\[Page (\d+)\]', chunk_text)
    if match:
        return int(match.group(1))
    return None

# Routes
@api_router.get("/")
async def root():
    return {"message": "Enterprise Document Q&A API"}

@api_router.post("/documents/upload")
async def upload_documents(files: List[UploadFile] = File(...)):
    """Upload one or multiple PDF documents"""
    uploaded_docs = []
    failed_files = []
    
    for file in files:
        try:
            # Validate PDF extension
            if not file.filename.endswith('.pdf'):
                failed_files.append({
                    "filename": file.filename,
                    "error": "Only PDF files are supported"
                })
                continue
            
            # Read file content
            content = await file.read()
            file_size = len(content)
            
            # Validate file is not empty
            if file_size == 0:
                failed_files.append({
                    "filename": file.filename,
                    "error": "File is empty"
                })
                continue
            
            # Extract text with validation
            try:
                text = extract_text_from_pdf(content)
                if not text or len(text.strip()) < 10:
                    failed_files.append({
                        "filename": file.filename,
                        "error": "Could not extract text from PDF or file contains no readable text"
                    })
                    continue
            except Exception as pdf_error:
                logger.error(f"PDF extraction error for {file.filename}: {pdf_error}")
                failed_files.append({
                    "filename": file.filename,
                    "error": "Invalid or corrupted PDF file"
                })
                continue
            
            # Create chunks
            chunks = chunk_text(text)
            
            if len(chunks) == 0:
                failed_files.append({
                    "filename": file.filename,
                    "error": "Document contains no processable content"
                })
                continue
            
            # Generate embeddings and store in ChromaDB
            doc_id = str(uuid.uuid4())
            for idx, chunk in enumerate(chunks):
                embedding = embedding_model.encode(chunk).tolist()
                page_num = extract_page_from_chunk(chunk)
                
                collection.add(
                    embeddings=[embedding],
                    documents=[chunk],
                    metadatas=[{
                        "filename": file.filename,
                        "doc_id": doc_id,
                        "chunk_index": idx,
                        "page": page_num if page_num else 0
                    }],
                    ids=[f"{doc_id}_{idx}"]
                )
            
            # Store document metadata in MongoDB
            doc = Document(
                id=doc_id,
                filename=file.filename,
                num_chunks=len(chunks),
                file_size=file_size
            )
            doc_dict = doc.model_dump()
            doc_dict['upload_date'] = doc_dict['upload_date'].isoformat()
            await db.documents.insert_one(doc_dict)
            
            uploaded_docs.append(doc)
            logger.info(f"Uploaded {file.filename} with {len(chunks)} chunks")
            
        except Exception as e:
            logger.error(f"Unexpected error uploading {file.filename}: {e}")
            failed_files.append({
                "filename": file.filename,
                "error": f"Unexpected error: {str(e)}"
            })
    
    # Return detailed response
    response = {
        "uploaded": len(uploaded_docs),
        "documents": uploaded_docs,
        "failed": len(failed_files),
        "failed_files": failed_files
    }
    
    # If all files failed, return error status
    if len(uploaded_docs) == 0 and len(failed_files) > 0:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "All files failed to upload",
                "failed_files": failed_files
            }
        )
    
    return response

@api_router.get("/documents", response_model=List[Document])
async def get_documents():
    """Get all uploaded documents"""
    docs = await db.documents.find({}, {"_id": 0}).to_list(1000)
    for doc in docs:
        if isinstance(doc['upload_date'], str):
            doc['upload_date'] = datetime.fromisoformat(doc['upload_date'])
    return docs

@api_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    """Delete a document"""
    # Delete from MongoDB
    result = await db.documents.delete_one({"id": doc_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete from ChromaDB
    try:
        # Get all chunk IDs for this document
        results = collection.get(where={"doc_id": doc_id})
        if results['ids']:
            collection.delete(ids=results['ids'])
    except Exception as e:
        logger.error(f"Error deleting from ChromaDB: {e}")
    
    return {"message": "Document deleted successfully"}

@api_router.post("/chat", response_model=AnswerResponse)
async def chat(request: QuestionRequest):
    """Ask a question and get a grounded answer"""
    try:
        # Generate query embedding
        query_embedding = embedding_model.encode(request.question).tolist()
        
        logger.info(f"Chroma collection count: {collection.count()}")

        # Query ChromaDB for relevant chunks
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=5
        )
        
        if not results['documents'][0]:
            return AnswerResponse(
                answer="I don't have any documents to answer from. Please upload documents first.",
                sources=[]
            )
        
        # Prepare context from retrieved chunks
        retrieved_chunks = []
        for idx, (doc, metadata) in enumerate(zip(results['documents'][0], results['metadatas'][0])):
            retrieved_chunks.append({
                "text": doc,
                "filename": metadata['filename'],
                "page": metadata.get('page', 0)
            })
        
        # Build prompt for GROQ
        context = "\n\n".join([
            f"[Source: {chunk['filename']}, Page: {chunk['page']}]\n{chunk['text']}"
            for chunk in retrieved_chunks
        ])
        
        system_prompt = """You are a GROUNDED SYNTHESIS ENGINE for enterprise internal documents.

Your purpose is to provide fast, precise, and fully grounded answers by retrieving relevant information from company PDFs.

RULES:
- Combine multiple statements ONLY if they describe the same fact or process
- Rephrase retrieved text for clarity and readability
- DO NOT add new facts or data that aren't in the source documents
- DO NOT infer intent, cause, or meaning
- DO NOT fill gaps with assumptions
- DO NOT resolve conflicting information arbitrarily

MANDATORY:
- If sources conflict → say: "The documents contain conflicting information."
- If information is partial or unclear → say: "The documents do not clearly specify this."
- If information exists across multiple chunks → combine into one clear explanation
- Always cite source documents by filename

OUTPUT FORMAT:
Answer: <your grounded answer based strictly on the retrieved chunks>
Source: <comma-separated list of source PDFs>"""
        
        user_prompt = f"""Question: {request.question}

Context from documents:
{context}

Provide a grounded answer based ONLY on the context above."""
        
        # # Call GROQ API
        # completion = await groq_client.chat.completions.create(
        #     model="llama-3.3-70b-versatile",
        #     messages=[
        #         {"role": "system", "content": system_prompt},
        #         {"role": "user", "content": user_prompt}
        #     ],
        #     temperature=0.1,
        #     max_tokens=1000
        # )
        
        # answer = completion.choices[0].message.content
        answer = f"This is a mock answer to: '{request.question}'"

        
        # Extract unique sources
        unique_sources = list(set([chunk['filename'] for chunk in retrieved_chunks]))
        
        # Store in chat history
        chat_msg = ChatMessage(
            question=request.question,
            answer=answer,
            sources=unique_sources
        )
        chat_dict = chat_msg.model_dump()
        chat_dict['timestamp'] = chat_dict['timestamp'].isoformat()
        await db.chat_history.insert_one(chat_dict)
        
        return AnswerResponse(
            answer=answer,
            sources=retrieved_chunks
        )
        
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/chat/history", response_model=List[ChatMessage])
async def get_chat_history():
    """Get chat history"""
    history = await db.chat_history.find({}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    for msg in history:
        if isinstance(msg['timestamp'], str):
            msg['timestamp'] = datetime.fromisoformat(msg['timestamp'])
    return history

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
