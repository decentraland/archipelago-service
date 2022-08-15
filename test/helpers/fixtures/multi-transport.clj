; initialize the archipelago
(configure)
(configureTransports [
     [0 0 0 50] ; p2p
     [1 6 0 3] 
  ])

; test case 1
(move ["1" 0 0 0]
      ["2" 16 0 16]
      ["3" 16 0 16])
(ensureIslandsCount 1)
(expectIslandWith ["1" "2" "3"])
(ensureIslandsCountWithTransport 1 1)


(move ["4" 16 0 16])
(ensureIslandsCount 2)
(expectIslandWith ["1" "2" "3"])
(expectIslandWith ["4"])
(ensureIslandsCountWithTransport 2 1)

(move ["5" 16 0 16]
      ["6" 16 0 16])
(expectIslandWith ["1" "2" "3"])
(expectIslandWith ["4" "5" "6"])
(ensureIslandsCountWithTransport 2 1)

(move ["7" 16 0 16])
(expectIslandWith ["1" "2" "3"])
(expectIslandWith ["4" "5" "6"])
(expectIslandWith ["7"])
(ensureIslandsCountWithTransport 2 1)
(ensureIslandsCountWithTransport 1 0)
