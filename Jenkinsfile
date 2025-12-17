pipeline {
    agent {
        docker { image 'node:20-alpine' } // Use Node.js official image
    }

    stages {
        stage('Checkout') {
            steps {
                git branch: 'main', url: 'https://github.com/johnroshan2255/docker-web-terminal.git'
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }

        stage('Build Svelte Project') {
            steps {
                sh 'npm run build || npm run dev'
            }
        }
    }

    post {
        success {
            echo 'Build succeeded!'
        }
        failure {
            echo 'Build failed!'
        }
    }
}
