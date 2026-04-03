import { useState } from "react";

function App() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query) return;

    setLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query,
          use_cache: true,
        }),
      });

      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
      alert("Error fetching data");
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: "2rem", fontFamily: "Arial" }}>
      <h1>Entity Discovery</h1>

      <input
        type="text"
        placeholder="Enter a query..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ padding: "0.5rem", width: "300px" }}
      />

      <button onClick={handleSearch} style={{ marginLeft: "10px" }}>
        Search
      </button>

      {loading && <p>Loading...</p>}

      {result && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Results</h2>
          {result.entities?.map((item, index) => (
            <div
              key={index}
              style={{
                border: "1px solid #ccc",
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <h3>{item.cafe_name}</h3>
              <p><b>Neighborhood:</b> {item.neighborhood}</p>
              <p><b>Why known:</b> {item.why_known}</p>
              <p><b>Confidence:</b> {item.confidence}</p>
              {item.website && (
                <a href={item.website} target="_blank">
                  Visit Website
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;