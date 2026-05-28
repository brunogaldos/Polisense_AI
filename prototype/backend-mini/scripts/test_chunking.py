import json
from pathlib import Path
from ingest import parse_pdf
from chunking_strategy import build_chunks_from_paper
def test_chunking_integrity(pdf_path):
    # 1. Parse the paper to get the rich object
    print(f"--- Testing {pdf_path.name} ---")
    paper = parse_pdf(pdf_path)
    
    # 2. Generate chunks using your new function
    chunks = build_chunks_from_paper(paper, max_chars=1200)
    
    print(f"Total Chunks Generated: {len(chunks)}")
    
    # 3. Check the first few chunks for the 'Grounding Passport'
    for i, chunk in enumerate(chunks):
        meta = chunk["metadata"]
        print(f"\n[Chunk {i}]")
        print(chunk)

if __name__ == "__main__":
    # Test with a specific PDF from your articles directory
    sample_pdf = Path("materials/articles/Baloch_2022.pdf")
    if sample_pdf.exists():
        test_chunking_integrity(sample_pdf)
    else:
        print("Sample PDF not found. Update the path in the script.")